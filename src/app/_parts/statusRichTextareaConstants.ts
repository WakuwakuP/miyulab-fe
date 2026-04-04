export const MAX_LIST_LENGTH = 8
export const MENTION_REG = /\B@([\\.@\-+\w]*)$/
export const MENTION_HIGHLIGHT_REG = new RegExp(/@([\\.@\-+\w]*)/, 'g')
export const EMOJI_REG = /\B:([+\w]*)$/
export const EMOJI_HIGHLIGHT_REG = new RegExp(/:([+\w]*):/, 'g')
export const TAG_REG = /#(\S*)$/
export const TAG_HIGHLIGHT_REG = new RegExp(/#(\S*)/, 'g')
