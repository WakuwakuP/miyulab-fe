import generator, { OAuth } from 'megalodon'

import { BACKEND_SNS, BACKEND_URL } from './environment'

export const GetClient = (
  token: OAuth.TokenData['access_token']
) => {
  return generator(
    BACKEND_SNS,
    `https://${BACKEND_URL}`,
    token
  )
}

export const GetStreamClient = (
  token: OAuth.TokenData['access_token']
) => {
  return generator(
    BACKEND_SNS,
    `wss://${BACKEND_URL}`,
    token
  )
}
