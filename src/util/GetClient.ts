import generator, { OAuth } from 'megalodon'

import { BACKEND_URL } from './environment'

export const GetClient = (token: OAuth.TokenData['access_token']) => {
  return generator('pleroma', `https://${BACKEND_URL}`, token)
}

export const GetStreamClient = (token: OAuth.TokenData['access_token']) => {
  return generator('pleroma', `wss://${BACKEND_URL}`, token)
}
