'use client'

import { useContext, useId, useState } from 'react'

import { type Entity } from 'megalodon'

import { GetClient } from 'util/GetClient'
import { TokenContext } from 'util/provider/AppProvider'

export const Poll = ({
  poll,
}: {
  poll?:
    | (Entity.Poll & { own_votes: number[] | undefined })
    | null
}) => {
  const internalId = useId()
  const token = useContext(TokenContext)

  const [selected, setSelected] = useState<number[]>(
    poll?.own_votes ?? []
  )

  const [voted, setVoted] = useState<boolean>(
    poll?.voted ?? false
  )

  const vote = () => {
    if (token == null) return
    if (poll == null || selected.length == 0) return
    const client = GetClient(token.access_token)
    client.votePoll(poll.id, selected).then(() => {
      setVoted(true)
    })
  }

  return poll != null ? (
    <div className="p-2">
      <div>
        {poll.options.map((option, index) => (
          <div
            key={option.title}
            className="w-full"
          >
            {voted ? (
              <div
                className="my-0.5 flex flex-wrap rounded-md px-2"
                style={{
                  backgroundImage:
                    option.votes_count != null &&
                    poll.votes_count > 0
                      ? `linear-gradient(
                    to right,
                    rgba(${selected?.some((s) => s === index) ? '255' : '59'},130,246,0.5) ${(option.votes_count / poll.votes_count ?? 1) * 100}%,
                    rgba(255,255,255,0.1) ${(option.votes_count / poll.votes_count ?? 1) * 100 * 1.05}%,
                    rgba(255,255,255,0.1) 100%
                    )`
                      : 'linear-gradient(rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.1) 100%)',
                }}
              >
                <span>{option.title}</span>
                <span className="ml-2 text-white/50">
                  {option.votes_count != null &&
                  poll.votes_count > 0
                    ? (
                        (option.votes_count /
                          poll.votes_count) *
                        100
                      ).toFixed(1)
                    : 0}
                  % ({option.votes_count})
                </span>
              </div>
            ) : (
              <label htmlFor={internalId + option.title}>
                <input
                  type={
                    poll.multiple ? 'checkbox' : 'radio'
                  }
                  id={internalId + option.title}
                  name={internalId + poll.id}
                  value={index}
                  className="mr-1"
                  checked={selected?.some(
                    (s) => s === index
                  )}
                  onChange={() => {
                    if (poll.voted) return
                    if (selected.includes(index)) {
                      setSelected(
                        selected.filter((s) => s !== index)
                      )
                    } else {
                      setSelected([...selected, index])
                    }
                  }}
                />
                {option.title}
              </label>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <div>
          {!voted && (
            <button
              className="rounded-md border-2 border-gray-600 p-1"
              onClick={vote}
            >
              Vote
            </button>
          )}
        </div>
        <div className="flex">
          <div>
            <span className="mr-1">{poll.votes_count}</span>
            votes
          </div>
          <div></div>
        </div>
      </div>
    </div>
  ) : null
}
