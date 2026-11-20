/**
 * 防护浏览器「翻译此页」改写 DOM 文本节点后，React commit 阶段
 * removeChild / insertBefore 抛出 NotFoundError（Safari: The object can not be found here）。
 * 必须在 createRoot 之前安装。
 *
 * 注意：绝不能对 native 方法 .bind(Node.prototype)，否则 this 被钉死，整页空白。
 */

let installed = false;

export function installBrowserTranslationGuard(): void {
  if (installed || typeof Node === 'undefined') return;
  installed = true;

  try {
    document.documentElement.setAttribute('translate', 'no');
  } catch {
    /* ignore */
  }

  const nativeRemove = Node.prototype.removeChild;
  const nativeInsert = Node.prototype.insertBefore;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Node.prototype as any).removeChild = function patchedRemoveChild(
    this: Node,
    child: Node
  ): Node {
    try {
      if (child.parentNode !== this) {
        // 翻译插件常把文本节点挪进 <font>，React 仍以为父节点是原元素
        return child;
      }
      return nativeRemove.call(this, child);
    } catch (err) {
      if (isNotFoundDomError(err)) return child;
      throw err;
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Node.prototype as any).insertBefore = function patchedInsertBefore(
    this: Node,
    node: Node,
    child: Node | null
  ): Node {
    try {
      if (child && child.parentNode !== this) {
        return nativeInsert.call(this, node, null);
      }
      return nativeInsert.call(this, node, child);
    } catch (err) {
      if (isNotFoundDomError(err)) {
        try {
          return nativeInsert.call(this, node, null);
        } catch {
          return node;
        }
      }
      throw err;
    }
  };
}

function isNotFoundDomError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string };
  const msg = String(e.message || '');
  return (
    e.name === 'NotFoundError' ||
    /object can not be found here/i.test(msg) ||
    /not a child of this node/i.test(msg) ||
    /The node before which the new node is to be inserted is not a child/i.test(msg)
  );
}
