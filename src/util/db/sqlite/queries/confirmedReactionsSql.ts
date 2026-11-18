/** Use the selected account's confirmed list, falling back to streamed post stats. */
export function confirmedReactionsSql(
  post: string,
  account: string,
  stats: string,
): string {
  return `COALESCE((SELECT CASE WHEN json_valid(pi.confirmed_reactions_json) THEN CASE WHEN json_type(pi.confirmed_reactions_json) = 'array' THEN pi.confirmed_reactions_json END END FROM post_interactions pi
    WHERE pi.post_id = ${post}.id AND pi.local_account_id = ${account}), ${stats}.emoji_reactions_json)`
}
