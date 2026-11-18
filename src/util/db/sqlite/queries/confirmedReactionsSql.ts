/** Use the selected account's confirmed list, falling back to streamed post stats. */
export function confirmedReactionsSql(
  post: string,
  account: string,
  stats: string,
): string {
  return `COALESCE((SELECT pi.confirmed_reactions_json FROM post_interactions pi
    WHERE pi.post_id = ${post}.id AND pi.local_account_id = ${account}), ${stats}.emoji_reactions_json)`
}
