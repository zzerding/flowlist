import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { createElement as h } from "react"

import { StaticContent, validateContent } from "./staticRenderer"

/**
 * 静态 renderer 契约(接缝 2,issue #2 决策记录第 3 条):
 * - Effect Schema 校验 Lexical JSON;失败返回 null,调用方降级纯文本;
 * - 降级「丢样式不丢内容」;
 * - 子集外格式丢样式不丢内容;链接仅放行安全协议。
 * 渲染断言用 renderToStaticMarkup —— 走公开 React 入口,不碰内部实现。
 */

const rootOf = (children: unknown[]) => ({ root: { type: "root", version: 1, children } })
const text = (t: string, format = 0) => ({ type: "text", version: 1, text: t, format })
const paragraph = (...children: unknown[]) => ({ type: "paragraph", version: 1, children })

describe("validateContent", () => {
  it("合法的 paragraph + text 通过校验", () => {
    expect(validateContent(rootOf([paragraph(text("hello"))]))).not.toBeNull()
  })

  it("heading(带 tag)/quote/listitem/link 均在校验子集内", () => {
    expect(
      validateContent(rootOf([{ type: "heading", version: 1, tag: "h1", children: [text("t")] }])),
    ).not.toBeNull()
    expect(validateContent(rootOf([{ type: "quote", version: 1, children: [text("t")] }]))).not.toBeNull()
    expect(
      validateContent(rootOf([{ type: "listitem", version: 1, checked: null, children: [text("t")] }])),
    ).not.toBeNull()
    expect(
      validateContent(
        rootOf([
          paragraph({
            type: "link",
            version: 1,
            url: "https://example.com",
            children: [text("link")],
          }),
        ]),
      ),
    ).not.toBeNull()
  })

  it("非对象 / 缺 root / root 类型错误 → null", () => {
    expect(validateContent(null)).toBeNull()
    expect(validateContent("plain string")).toBeNull()
    expect(validateContent(42)).toBeNull()
    expect(validateContent({})).toBeNull()
    expect(validateContent({ root: { type: "not-root", version: 1, children: [] } })).toBeNull()
  })

  it("未知块级类型 → null(触发降级)", () => {
    expect(validateContent(rootOf([{ type: "table", version: 1, children: [text("x")] }]))).toBeNull()
  })

  it("行内未知类型(嵌套块级结构)→ null(子集外降级)", () => {
    expect(
      validateContent(rootOf([paragraph({ type: "image", version: 1, src: "x" })])),
    ).toBeNull()
  })
})

describe("StaticContent 渲染", () => {
  const render = (props: Parameters<typeof StaticContent>[0]): string =>
    renderToStaticMarkup(h(StaticContent, props))

  it("合法 JSON 渲染出文本内容", () => {
    const html = render({ raw: rootOf([paragraph(text("你好世界"))]) })
    expect(html).toContain("你好世界")
  })

  it("行内格式:粗体/斜体/删除线/代码映射为 strong/em/del/code", () => {
    const cases: Array<[number, string]> = [
      [1, "strong"],
      [2, "em"],
      [16, "del"],
      [32, "code"],
    ]
    for (const [format, tag] of cases) {
      const html = render({ raw: rootOf([paragraph(text("x", format))]) })
      expect(html).toContain(`<${tag}>`)
    }
  })

  it("link 渲染为带 rel=noopener 的 <a>;非 http(s) 协议不放出 <a href>", () => {
    const safe = render({
      raw: rootOf([
        paragraph({ type: "link", version: 1, url: "https://example.com", children: [text("ok")] }),
      ]),
    })
    expect(safe).toContain('href="https://example.com"')
    expect(safe).toContain('rel="noopener noreferrer"')

    const unsafe = render({
      raw: rootOf([
        paragraph({ type: "link", version: 1, url: "javascript:alert(1)", children: [text("bad")] }),
      ]),
    })
    expect(unsafe).not.toContain('href="javascript:')
  })

  it("校验失败时降级纯文本:fallbackText 优先,丢样式不丢内容", () => {
    const bad = { root: { type: "root", version: 1, children: [{ type: "table", version: 1 }] } }
    expect(render({ raw: bad, fallbackText: "降级文本" })).toContain("降级文本")
  })

  it("校验失败且无 fallbackText 时从 JSON 深度提取 text,不丢内容", () => {
    const bad = {
      root: {
        type: "root",
        version: 1,
        children: [
          { type: "unknownblock", version: 1, children: [{ type: "text", version: 1, text: "内容保留" }] },
        ],
      },
    }
    const html = render({ raw: bad })
    expect(html).toContain("内容保留")
  })

  it("heading tag 映射:h1/h2/h3;listitem 渲染 checkbox 语义", () => {
    expect(
      render({ raw: rootOf([{ type: "heading", version: 1, tag: "h2", children: [text("t")] }]) }),
    ).toContain("<h2")
    const todo = render({
      raw: rootOf([{ type: "listitem", version: 1, checked: true, children: [text("t")] }]),
    })
    expect(todo).toContain("checkbox")
    expect(todo).toContain("done")
  })
})
