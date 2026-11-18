/** Use the selected account's confirmed list, falling back to streamed post stats. */
export function confirmedReactionsSql(
  post: string,
  account: string,
  stats: string,
): string {
  return `COALESCE((SELECT CASE WHEN json_valid(pi.confirmed_reactions_json) THEN CASE WHEN json_type(pi.confirmed_reactions_json) = 'array' THEN pi.confirmed_reactions_json END END FROM post_interactions pi
    WHERE pi.post_id = ${post}.id AND pi.local_account_id = ${account}),
    CASE WHEN EXISTS (
      SELECT 1 FROM local_accounts selected JOIN local_accounts other ON other.backend_url = selected.backend_url
      WHERE selected.id = ${account} AND other.id <> selected.id
    ) THEN (SELECT json_group_array(json_set(r.value, '$.me', json('false')))
      FROM json_each(CASE WHEN json_valid(${stats}.emoji_reactions_json) THEN ${stats}.emoji_reactions_json ELSE '[]' END) r WHERE r.type = 'object')
    ELSE ${stats}.emoji_reactions_json END)`
}
