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
import tempfile
import termios
from pathlib import Path

from fastapi import WebSocket, WebSocketDisconnect

from agent.ide_fs import project_root

_log = logging.getLogger("agent.terminal")
_IDLE_SEC = 30 * 60

_COLOR_RC = """# meostock agent terminal — enable colored ls/grep, then load user rc
export CLICOLOR=1 CLICOLOR_FORCE=1 FORCE_COLOR=1 TERM=xterm-256color COLORTERM=truecolor
alias ls='ls -G' 2>/dev/null
alias ll='ls -Glah' 2>/dev/null
alias grep='grep --color=auto' 2>/dev/null
alias egrep='egrep --color=auto' 2>/dev/null
"""


def _set_winsize(fd: int, rows: int, cols: int) -> None:
    try:
        winsize = struct.pack("HHHH", max(1, rows), max(1, cols), 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except OSError:
        pass


def _set_nonblock(fd: int) -> None:
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)


def _color_shell_argv(shell: str) -> tuple[list[str], dict[str, str]]:
    """交互 shell + 彩色 ls；尽量仍加载用户自己的 rc。"""
    extra_env: dict[str, str] = {}
    name = Path(shell).name
    root = Path(tempfile.gettempdir()) / "meostock-agent-term"
    root.mkdir(parents=True, exist_ok=True)

    if name == "zsh" or shell.endswith("/zsh"):
        zdot = root / "zdot"
        zdot.mkdir(exist_ok=True)
        zshrc = zdot / ".zshrc"
        body = (
            _COLOR_RC
            + '[[ -f "$HOME/.zshrc" ]] && source "$HOME/.zshrc"\n'
        )
        if not zshrc.is_file() or zshrc.read_text(encoding="utf-8") != body:
            zshrc.write_text(body, encoding="utf-8")
        extra_env["ZDOTDIR"] = str(zdot)
        return [shell, "-i"], extra_env

    if name == "bash" or shell.endswith("/bash"):
        rc = root / "bashrc"
        body = (
            _COLOR_RC
            + '[[ -f "$HOME/.bashrc" ]] && source "$HOME/.bashrc"\n'
            + '[[ -f "$HOME/.bash_profile" ]] && source "$HOME/.bash_profile"\n'
        )
        if not rc.is_file() or rc.read_text(encoding="utf-8") != body:
            rc.write_text(body, encoding="utf-8")
        return [shell, "--rcfile", str(rc), "-i"], extra_env

    return [shell, "-i"], extra_env


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
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    env["MEOSTOCK_AGENT_TERMINAL"] = "1"
    # 强制/提示彩色输出（ls、grep、许多 CLI）
    env["CLICOLOR"] = "1"
    env["CLICOLOR_FORCE"] = "1"
    env["FORCE_COLOR"] = "1"
    # macOS BSD ls：目录蓝、可执行绿、链接青…
    env.setdefault("LSCOLORS", "ExGxFxdxCxegedabagacad")
    # GNU / 多数工具用的扩展名着色
    env.setdefault(
        "LS_COLORS",
        ":".join(
            [
                "di=1;34",  # 目录
                "ln=1;36",  # 符号链接
                "so=1;35",
                "pi=33",
                "ex=1;32",  # 可执行
                "bd=1;33",
                "cd=1;33",
                "su=1;31",
                "sg=1;31",
                "tw=1;34",
                "ow=1;34",
                "*.py=1;33",
                "*.ts=1;34",
                "*.tsx=1;34",
                "*.js=1;33",
                "*.jsx=1;33",
                "*.mjs=1;33",
                "*.json=0;33",
                "*.md=1;36",
                "*.sh=1;32",
                "*.bash=1;32",
                "*.zsh=1;32",
                "*.css=1;35",
                "*.scss=1;35",
                "*.html=1;35",
                "*.yml=0;33",
                "*.yaml=0;33",
                "*.toml=0;33",
                "*.go=1;36",
                "*.rs=1;31",
                "*.sql=0;36",
                "*.txt=0;37",
                "*.log=0;90",
                "*.gz=1;31",
                "*.zip=1;31",
            ]
        ),
    )
    argv, shell_env = _color_shell_argv(shell)
    env.update(shell_env)

    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
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
