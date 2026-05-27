export const MAX_LIST_LENGTH = 8
const MENTION_CAPTURE = '[\\.@\\-+\\w]{0,64}'
const EMOJI_CAPTURE = '[+\\w]{0,64}'
const TAG_CAPTURE = '[^\\s#]{0,64}'

export const MENTION_REG = new RegExp(`\\B@(${MENTION_CAPTURE})$`)
export const MENTION_HIGHLIGHT_REG = new RegExp(`@(${MENTION_CAPTURE})`, 'g')
export const EMOJI_REG = new RegExp(`\\B:(${EMOJI_CAPTURE})$`)
export const EMOJI_HIGHLIGHT_REG = new RegExp(`:(${EMOJI_CAPTURE}):`, 'g')
export const TAG_REG = new RegExp(`#(${TAG_CAPTURE})$`)
export const TAG_HIGHLIGHT_REG = new RegExp(`#(${TAG_CAPTURE})`, 'g')
