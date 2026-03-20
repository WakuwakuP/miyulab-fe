'use client'

import type { Entity } from 'megalodon'
import { useContext, useId, useState } from 'react'
import type { PollAddAppIndex } from 'types/types'
import { GetClient } from 'util/GetClient'
import { AppsContext } from 'util/provider/AppsProvider'

type PollWithOwnVotes = PollAddAppIndex & {
  own_votes: number[] | undefined
}

/** API の expired と期限日時の両方を見る（タブ放置中の経過やキャッシュ復元でも整合しやすい） */
function isPollClosed(p: Entity.Poll): boolean {
  if (p.expired) return true
  if (p.expires_at == null) return false
  return new Date(p.expires_at) < new Date()
}

export const Poll = ({
  poll: initialPoll,
}: {
  poll?: PollWithOwnVotes | null
}) => {
  const internalId = useId()
  const apps = useContext(AppsContext)

  const [poll, setPoll] = useState<PollWithOwnVotes | null | undefined>(
    initialPoll,
  )

  const [selected, setSelected] = useState<number[]>(
    initialPoll?.own_votes ?? [],
  )

  const [voted, setVoted] = useState<boolean>(initialPoll?.voted ?? false)

  const [voting, setVoting] = useState(false)

  const vote = () => {
    if (apps.length <= 0) return
    if (poll == null || selected.length === 0) return
    if (isPollClosed(poll)) return
    setVoting(true)
    const client = GetClient(apps[poll.appIndex])
    client
      .votePoll(poll.id, selected)
      .then((response) => {
        const updatedPoll: Entity.Poll = response.data
        setPoll({
          ...updatedPoll,
          appIndex: poll.appIndex,
          own_votes: selected,
        })
        setVoted(true)
      })
      .catch((error) => {
        console.error('Failed to vote poll:', error)
      })
      .finally(() => {
        setVoting(false)
      })
  }

  const pollClosed = poll != null ? isPollClosed(poll) : false
  const showResults = poll != null && (poll.voted || voted || pollClosed)

  return poll != null ? (
    <div className="p-2">
      <div>
        {poll.options.map((option, index) => (
          <div className="w-full" key={option.title}>
            {showResults ? (
              <div
                className="my-0.5 flex flex-wrap rounded-md px-2"
                style={{
                  backgroundImage:
                    option.votes_count != null && poll.votes_count > 0
                      ? `linear-gradient(
                    to right,
                    rgba(${selected?.some((s) => s === index) ? '255' : '59'},130,246,0.5) ${(option.votes_count / poll.votes_count) * 100}%,
                    rgba(255,255,255,0.1) ${(option.votes_count / poll.votes_count) * 100 * 1.05}%,
                    rgba(255,255,255,0.1) 100%
                    )`
                      : 'linear-gradient(rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.1) 100%)',
                }}
              >
                <span>{option.title}</span>
                <span className="ml-2 text-white/50">
                  {option.votes_count != null && poll.votes_count > 0
                    ? ((option.votes_count / poll.votes_count) * 100).toFixed(1)
                    : 0}
                  % ({option.votes_count})
                </span>
              </div>
            ) : (
              <label htmlFor={internalId + option.title}>
                <input
                  checked={selected?.some((s) => s === index)}
                  className="mr-1"
                  id={internalId + option.title}
                  name={internalId + poll.id}
                  onChange={() => {
                    if (poll.voted || isPollClosed(poll)) return
                    if (selected.includes(index)) {
                      setSelected(selected.filter((s) => s !== index))
                    } else {
                      setSelected([...selected, index])
                    }
                  }}
                  type={poll.multiple ? 'checkbox' : 'radio'}
                  value={index}
                />
                {option.title}
              </label>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          {!showResults && (
            <button
              className="rounded-md border-2 border-gray-600 p-1 disabled:opacity-50"
              disabled={voting || selected.length === 0}
              onClick={vote}
              type="button"
            >
              {voting ? 'Voting...' : 'Vote'}
            </button>
          )}
          {pollClosed && (
            <span className="text-sm text-white/50">投票終了</span>
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
