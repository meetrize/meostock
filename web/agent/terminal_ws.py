"""Agent IDE：本机 PTY WebSocket（cwd = 当前项目根）。

用 asyncio.create_subprocess_exec + openpty，避免在 uvicorn 里 os.fork()。
"""

from __future__ import annotations

import asyncio
import errno
import fcntl
import json
import logging
import os
import pty
import signal
import struct
import termios

from fastapi import WebSocket, WebSocketDisconnect

from agent.ide_fs import project_root

_log = logging.getLogger("agent.terminal")
_IDLE_SEC = 30 * 60


def _set_winsize(fd: int, rows: int, cols: int) -> None:
    try:
        winsize = struct.pack("HHHH", max(1, rows), max(1, cols), 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except OSError:
        pass


def _set_nonblock(fd: int) -> None:
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)


async def handle_terminal_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    project_id = websocket.query_params.get("projectId") or "meostock"
    try:
        root, proj = project_root(project_id)
    except Exception as e:  # noqa: BLE001
        await websocket.send_text(json.dumps({"type": "error", "error": str(e)}))
        await websocket.close()
        return

    cwd = str(root)
    shell = os.environ.get("SHELL") or "/bin/zsh"
    if not os.path.isfile(shell):
        shell = "/bin/bash"

    master, slave = pty.openpty()
    _set_winsize(master, 24, 80)
    _set_nonblock(master)

    env = os.environ.copy()
    env["TERM"] = env.get("TERM") or "xterm-256color"
    env["MEOSTOCK_AGENT_TERMINAL"] = "1"

    try:
        proc = await asyncio.create_subprocess_exec(
            shell,
            "-i",
            stdin=slave,
            stdout=slave,
            stderr=slave,
            cwd=cwd,
            env=env,
            start_new_session=True,
        )
    except Exception as e:  # noqa: BLE001
        for fd in (master, slave):
            try:
                os.close(fd)
            except OSError:
                pass
        await websocket.send_text(
            json.dumps({"type": "error", "error": f"启动 shell 失败: {e}"})
        )
        await websocket.close()
        return

    try:
        os.close(slave)
    except OSError:
        pass
    slave = -1

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[bytes | None] = asyncio.Queue()

    def _on_readable() -> None:
        try:
            while True:
                try:
                    data = os.read(master, 8192)
                except BlockingIOError:
                    break
                except OSError as e:
                    if e.errno in (errno.EIO, errno.EBADF):
                        queue.put_nowait(None)
                        stop.set()
                    break
                else:
                    if not data:
                        queue.put_nowait(None)
                        stop.set()
                        break
                    queue.put_nowait(data)
        except Exception as e:  # noqa: BLE001
            _log.warning("pty readable: %s", e)
            queue.put_nowait(None)
            stop.set()

    loop.add_reader(master, _on_readable)

    async def _pump_out() -> None:
        while not stop.is_set():
            chunk = await queue.get()
            if chunk is None:
                stop.set()
                break
            try:
                await websocket.send_bytes(chunk)
            except Exception:  # noqa: BLE001
                stop.set()
                break

    pump = asyncio.create_task(_pump_out())

    await websocket.send_text(
        json.dumps(
            {
                "type": "ready",
                "projectId": proj.get("id"),
                "cwd": cwd,
                "shell": shell,
            },
            ensure_ascii=False,
        )
    )

    last_activity = loop.time()

    try:
        while not stop.is_set():
            if proc.returncode is not None:
                break
            try:
                msg = await asyncio.wait_for(websocket.receive(), timeout=5.0)
            except asyncio.TimeoutError:
                if loop.time() - last_activity > _IDLE_SEC:
                    await websocket.send_text(
                        json.dumps({"type": "error", "error": "空闲超时，已断开"})
                    )
                    break
                continue

            last_activity = loop.time()
            if msg.get("type") == "websocket.disconnect":
                break

            if "bytes" in msg and msg["bytes"] is not None:
                try:
                    os.write(master, msg["bytes"])
                except OSError:
                    break
                continue

            text = msg.get("text")
            if text is None:
                continue
            if text.startswith("{") and '"type"' in text:
                try:
                    obj = json.loads(text)
                except json.JSONDecodeError:
                    os.write(master, text.encode("utf-8", errors="replace"))
                    continue
                if obj.get("type") == "resize":
                    _set_winsize(
                        master,
                        int(obj.get("rows") or 24),
                        int(obj.get("cols") or 80),
                    )
                    try:
                        if proc.pid:
                            os.kill(proc.pid, signal.SIGWINCH)
                    except OSError:
                        pass
                elif obj.get("type") == "stdin":
                    data = str(obj.get("data") or "")
                    os.write(master, data.encode("utf-8", errors="replace"))
                continue
            os.write(master, text.encode("utf-8", errors="replace"))
    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001
        _log.warning("terminal ws failed: %s", e)
    finally:
        stop.set()
        try:
            loop.remove_reader(master)
        except Exception:  # noqa: BLE001
            pass
        pump.cancel()
        try:
            await pump
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        try:
            os.close(master)
        except OSError:
            pass
        if proc.returncode is None:
            try:
                proc.terminate()
                await asyncio.wait_for(proc.wait(), timeout=2.0)
            except Exception:  # noqa: BLE001
                try:
                    proc.kill()
                except Exception:  # noqa: BLE001
                    pass
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass
