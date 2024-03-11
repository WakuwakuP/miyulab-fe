import generator, { OAuth } from 'megalodon'

import { BACKEND_SNS, BACKEND_URL } from './environment'

export const GetClient = (
  token: OAuth.TokenData['access_token']
) => {
  return generator(BACKEND_SNS, BACKEND_URL, token)
}
