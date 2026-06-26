import type { Entity } from 'megalodon'
import type { MfmFn, MfmNode } from 'mfm-js'
import { extract, parse } from 'mfm-js'
import { escapeHtml } from 'util/escapeHtml'

// ========================================
// MFM Text → HTML Conversion (mfm-js AST based)
// ========================================

/**
 * MFM テキストを HTML に変換する。
 * mfm-js パーサーで AST を構築し、各ノードを HTML に変換する。
 */
export function mfmToHtml(text: string, instanceHost = ''): string {
  const nodes = parse(text)
  return nodesToHtml(nodes, instanceHost)
}

/**
 * MFM テキストからメンション情報を抽出する。
 */
export function parseMentionsFromMfm(
  text: string,
  instanceHost = '',
): Entity.Mention[] {
  const nodes = parse(text)
  const mentionNodes = extract(nodes, (node) => node.type === 'mention')
  return mentionNodes.map((node) => {
    if (node.type !== 'mention')
      return { acct: '', id: '', url: '', username: '' }
    const { username, host: mentionHost, acct } = node.props
    const url = mentionHost
      ? `https://${mentionHost}/@${username}`
      : `${instanceHost}/@${username}`
    return { acct, id: '', url, username }
  })
}

// ========================================
// Internal: AST → HTML
// ========================================

function nodesToHtml(nodes: MfmNode[], host: string): string {
  return nodes.map((node) => nodeToHtml(node, host)).join('')
}

function childrenToHtml(node: { children?: MfmNode[] }, host: string): string {
  return (node.children ?? []).map((child) => nodeToHtml(child, host)).join('')
}

function nodeToHtml(node: MfmNode, host: string): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.props.text).replace(/\n/g, '<br>')
    case 'bold':
      return `<strong>${childrenToHtml(node, host)}</strong>`
    case 'italic':
      return `<em>${childrenToHtml(node, host)}</em>`
    case 'strike':
      return `<del>${childrenToHtml(node, host)}</del>`
    case 'small':
      return `<small>${childrenToHtml(node, host)}</small>`
    case 'center':
      return `<div style="text-align:center">${childrenToHtml(node, host)}</div>`
    case 'plain':
      return childrenToHtml(node, host)
    case 'quote':
      return `<blockquote>${childrenToHtml(node, host)}</blockquote>`
    case 'blockCode': {
      const langAttr = node.props.lang
        ? ` class="language-${escapeHtml(node.props.lang)}"`
        : ''
      return `<pre><code${langAttr}>${escapeHtml(node.props.code)}</code></pre>`
    }
    case 'inlineCode':
      return `<code>${escapeHtml(node.props.code)}</code>`
    case 'mathBlock':
      return `<div class="mfm-math-block">${escapeHtml(node.props.formula)}</div>`
    case 'mathInline':
      return `<span class="mfm-math-inline">${escapeHtml(node.props.formula)}</span>`
    case 'mention': {
      const acct = node.props.host
        ? `${node.props.username}@${node.props.host}`
        : node.props.username
      const href = node.props.host
        ? `https://${node.props.host}/@${node.props.username}`
        : `${host}/@${node.props.username}`
      return `<a href="${escapeHtml(href)}" class="mention" rel="noopener noreferrer">@${escapeHtml(acct)}</a>`
    }
    case 'hashtag':
      return `<a href="${host}/tags/${escapeHtml(node.props.hashtag)}" class="hashtag" rel="tag noopener noreferrer">#${escapeHtml(node.props.hashtag)}</a>`
    case 'url':
      return `<a href="${escapeHtml(node.props.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(node.props.url)}</a>`
    case 'link':
      return `<a href="${escapeHtml(node.props.url)}" rel="noopener noreferrer" target="_blank">${childrenToHtml(node, host)}</a>`
    case 'emojiCode':
      return `:${node.props.name}:`
    case 'unicodeEmoji':
      return node.props.emoji
    case 'search':
      return `<a href="https://www.google.com/search?q=${encodeURIComponent(node.props.query)}" rel="noopener noreferrer" target="_blank" class="mfm-search">${escapeHtml(node.props.content)}</a>`
    case 'fn':
      return fnToHtml(node, host)
    default:
      return ''
  }
}

// ========================================
// MFM Function ($[fn ...]) → HTML
// ========================================

type MfmFnArgs = MfmFn['props']['args']
type FnHtmlRenderer = (
  args: MfmFnArgs,
  children: string,
  name: string,
) => string

function fnToHtml(node: MfmFn, host: string): string {
  const { name, args } = node.props
  const children = childrenToHtml(node, host)
  const renderer = fnHtmlRenderers[name]
  return renderer ? renderer(args, children, name) : children
}

function renderAnimationFn(
  args: MfmFnArgs,
  children: string,
  name: string,
): string {
  const speed = sanitizeDuration(args.speed)
  const delay = sanitizeDuration(args.delay)
  const style = buildStyleAttr({
    animationDelay: delay,
    animationDuration: speed,
  })
  return `<span class="mfm-${name}"${style}>${children}</span>`
}

function renderSpinFn(args: MfmFnArgs, children: string): string {
  const speed = sanitizeDuration(args.speed) ?? '1.5s'
  const direction = args.alternate != null ? 'alternate' : 'normal'
  const axis = getSpinAxis(args)
  const cls = axis ? `mfm-spin-${axis}` : 'mfm-spin'
  return `<span class="${cls}" style="animation-duration:${speed};animation-direction:${direction}">${children}</span>`
}

function getSpinAxis(args: MfmFnArgs): 'x' | 'y' | '' {
  if (args.x != null) return 'x'
  if (args.y != null) return 'y'
  return ''
}

function renderFlipFn(args: MfmFnArgs, children: string): string {
  const transforms: string[] = []
  if (args.h != null) transforms.push('scaleX(-1)')
  if (args.v != null) transforms.push('scaleY(-1)')
  if (transforms.length === 0) transforms.push('scaleX(-1)')
  return `<span style="display:inline-block;transform:${transforms.join(' ')}">${children}</span>`
}

function renderScaleClassFn(
  className: string,
  _args: MfmFnArgs,
  children: string,
): string {
  return `<span class="${className}">${children}</span>`
}

function getFontFamily(args: MfmFnArgs): string | null {
  if (args.serif != null) return 'serif'
  if (args.monospace != null) return 'monospace'
  if (args.cursive != null) return 'cursive'
  if (args.fantasy != null) return 'fantasy'
  if (args.math != null) return 'math'
  return null
}

function renderFontFn(args: MfmFnArgs, children: string): string {
  const family = getFontFamily(args)
  if (!family) return children
  return `<span style="font-family:${family}">${children}</span>`
}

function renderRainbowFn(args: MfmFnArgs, children: string): string {
  const speed = sanitizeDuration(args.speed) ?? '1s'
  return `<span class="mfm-rainbow" style="animation-duration:${speed}">${children}</span>`
}

function renderRotateFn(args: MfmFnArgs, children: string): string {
  const deg = sanitizeNumber(args.deg) ?? '90'
  return `<span style="display:inline-block;transform:rotate(${deg}deg);transform-origin:center center">${children}</span>`
}

function renderPositionFn(args: MfmFnArgs, children: string): string {
  const x = sanitizeNumber(args.x) ?? '0'
  const y = sanitizeNumber(args.y) ?? '0'
  return `<span style="display:inline-block;transform:translate(${x}em,${y}em)">${children}</span>`
}

function renderScaleFn(args: MfmFnArgs, children: string): string {
  const x = sanitizeNumber(args.x) ?? '1'
  const y = sanitizeNumber(args.y) ?? '1'
  return `<span style="display:inline-block;transform:scale(${x},${y})">${children}</span>`
}

function renderColorSpanFn(
  styleProperty: 'color' | 'background-color',
  args: MfmFnArgs,
  children: string,
): string {
  const color = sanitizeColor(args.color)
  if (!color) return children
  return `<span style="${styleProperty}:${color}">${children}</span>`
}

function renderBorderFn(args: MfmFnArgs, children: string): string {
  const style = sanitizeBorderStyle(args.style) ?? 'solid'
  const width = sanitizeNumber(args.width) ?? '1'
  const radius = sanitizeNumber(args.radius) ?? '0'
  const color = sanitizeColor(args.color) ?? 'currentColor'
  const noclip = args.noclip != null
  return `<span style="display:inline-block;border:${width}px ${style} ${color};border-radius:${radius}px;${noclip ? '' : 'overflow:hidden;'}padding:4px">${children}</span>`
}

const fnHtmlRenderers: Partial<Record<string, FnHtmlRenderer>> = {
  bg: (args, children) => renderColorSpanFn('background-color', args, children),
  blur: (_args, children) => `<span class="mfm-blur">${children}</span>`,
  border: renderBorderFn,
  bounce: renderAnimationFn,
  fg: (args, children) => renderColorSpanFn('color', args, children),
  flip: renderFlipFn,
  font: renderFontFn,
  jelly: renderAnimationFn,
  jump: renderAnimationFn,
  position: renderPositionFn,
  rainbow: renderRainbowFn,
  rotate: renderRotateFn,
  scale: renderScaleFn,
  shake: renderAnimationFn,
  sparkle: (_args, children) => `<span class="mfm-sparkle">${children}</span>`,
  spin: renderSpinFn,
  tada: renderAnimationFn,
  twitch: renderAnimationFn,
  x2: (args, children) => renderScaleClassFn('mfm-x2', args, children),
  x3: (args, children) => renderScaleClassFn('mfm-x3', args, children),
  x4: (args, children) => renderScaleClassFn('mfm-x4', args, children),
}

// ========================================
// Sanitization Helpers
// ========================================

// escapeHtml is imported from util/escapeHtml

/** CSS duration (e.g. "1s", "500ms", "0.5s") を検証 */
function sanitizeDuration(
  value: string | true | undefined,
): string | undefined {
  if (value == null || value === true) return undefined
  return /^\d+(\.\d+)?(s|ms)$/.test(value) ? value : undefined
}

/** 数値文字列を検証 (負数・小数を許容) */
function sanitizeNumber(value: string | true | undefined): string | undefined {
  if (value == null || value === true) return undefined
  return /^-?\d+(\.\d+)?$/.test(value) ? value : undefined
}

/** CSS カラー値を検証 (hex のみ許容) */
function sanitizeColor(value: string | true | undefined): string | undefined {
  if (value == null || value === true) return undefined
  return /^[0-9a-fA-F]{3,8}$/.test(value) ? `#${value}` : undefined
}

/** border-style を検証 */
function sanitizeBorderStyle(
  value: string | true | undefined,
): string | undefined {
  if (value == null || value === true) return undefined
  const allowed = ['solid', 'dashed', 'dotted', 'double', 'none', 'hidden']
  return allowed.includes(value) ? value : undefined
}

/** undefined を除外して style 属性文字列を構築 */
function buildStyleAttr(props: Record<string, string | undefined>): string {
  const parts = Object.entries(props)
    .filter((entry): entry is [string, string] => entry[1] != null)
    .map(([key, value]) => `${camelToKebab(key)}:${value}`)
  return parts.length > 0 ? ` style="${parts.join(';')}"` : ''
}

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}
