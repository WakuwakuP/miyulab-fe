# SonarQube CE MCP — 利用可能メトリクス一覧

SonarQube Community Edition に接続する **SonarQube CE MCP** から取得できるメトリクスと、`miyulab-fe` プロジェクトの最新スナップショット（2026-05-27 時点）です。

## MCP でメトリクスを扱うツール

| ツール | 用途 |
|--------|------|
| `search_metrics` | インスタンスで定義されている全メトリクス定義（キー・名前・ドメイン・型）を検索 |
| `get_component_measures` | プロジェクト／モジュール／ファイルのメトリクス値を取得（`projectKey` + `metricKeys` 必須） |
| `get_project_quality_gate_status` | Quality Gate の合否と条件ごとの結果 |
| `list_quality_gates` | 登録されている Quality Gate 定義 |
| `search_files_by_coverage` | カバレッジが低いファイルを検索 |
| `get_file_coverage_details` | ファイル単位の行カバレッジ詳細 |
| `search_sonar_issues_in_projects` | イシュー（バグ・脆弱性・コードスメル）の検索 |
| `search_security_hotspots` | セキュリティホットスポットの検索 |
| `search_duplicated_files` / `get_duplications` | 重複コード関連 |
| `search_dependency_risks` | SCA（依存関係リスク） |

プロジェクトキーは `sonar-project.properties` の `sonar.projectKey` を使用します。

```
WakuwakuP_miyulab-fe_4aa1e963-ad00-4ad4-9169-1d86c0671a4d
```

## 全メトリクス一覧（149 件）

`search_metrics`（`ps=500`）で取得。`hidden: true` は UI 非表示の内部用メトリクスです。

### Issues（イシュー数・状態）

| キー | 名前 | 型 |
|------|------|-----|
| `accepted_issues` | Accepted Issues | INT |
| `high_impact_accepted_issues` | Blocker and High Severity Accepted Issues | INT |
| `blocker_violations` | Blocker Issues | INT |
| `software_quality_blocker_issues` | Blocker Severity Issues | INT |
| `confirmed_issues` | Confirmed Issues | INT |
| `critical_violations` | Critical Issues | INT |
| `false_positive_issues` | False Positive Issues | INT |
| `info_violations` | Info Issues | INT |
| `software_quality_info_issues` | Info Severity Issues | INT |
| `violations` | Issues | INT |
| `prioritized_rule_issues` | Issues from prioritized rules | INT |
| `major_violations` | Major Issues | INT |
| `software_quality_medium_issues` | Medium Severity Issues | INT |
| `minor_violations` | Minor Issues | INT |
| `software_quality_low_issues` | Low Severity Issues | INT |
| `software_quality_high_issues` | High Severity Issues | INT |
| `open_issues` | Open Issues | INT |
| `reopened_issues` | Reopened Issues | INT |
| `new_accepted_issues` | New Accepted Issues | INT |
| `new_blocker_violations` | New Blocker Issues | INT |
| `new_software_quality_blocker_issues` | New Blocker Severity Issues | INT |
| `new_critical_violations` | New Critical Issues | INT |
| `new_info_violations` | New Info Issues | INT |
| `new_software_quality_info_issues` | New Info Severity Issues | INT |
| `new_violations` | New Issues | INT |
| `new_major_violations` | New Major Issues | INT |
| `new_software_quality_medium_issues` | New Medium Severity Issues | INT |
| `new_minor_violations` | New Minor Issues | INT |
| `new_software_quality_low_issues` | New Low Severity Issues | INT |
| `new_software_quality_high_issues` | New High Severity Issues | INT |
| `pull_request_fixed_issues` | Pull request fixed issues | INT (hidden) |
| `analysis_from_sonarqube_9_4` | Analysis From SonarQube 9.4 | BOOL (hidden) |
| `issues_in_sandbox` | Issues in Sandbox | INT (hidden) |
| `new_issues_in_sandbox` | New Issues in Sandbox | INT (hidden) |

### Reliability（信頼性）

| キー | 名前 | 型 |
|------|------|-----|
| `bugs` | Bugs | INT |
| `new_bugs` | New Bugs | INT |
| `reliability_issues` | Reliability Issues | DATA |
| `software_quality_reliability_issues` | Reliability Issues | INT |
| `new_reliability_issues` | New Reliability Issues | DATA |
| `new_software_quality_reliability_issues` | New Reliability Issues | INT |
| `reliability_rating` | Reliability Rating | RATING |
| `software_quality_reliability_rating` | Reliability Rating | RATING |
| `new_reliability_rating` | Reliability Rating on New Code | RATING |
| `new_software_quality_reliability_rating` | Reliability Rating on New Code | RATING |
| `reliability_remediation_effort` | Reliability Remediation Effort | WORK_DUR |
| `software_quality_reliability_remediation_effort` | Reliability Remediation Effort | WORK_DUR |
| `new_reliability_remediation_effort` | Reliability Remediation Effort on New Code | WORK_DUR |
| `new_software_quality_reliability_remediation_effort` | Reliability Remediation Effort on New Code | WORK_DUR |

### Security（セキュリティ）

| キー | 名前 | 型 |
|------|------|-----|
| `vulnerabilities` | Vulnerabilities | INT |
| `new_vulnerabilities` | New Vulnerabilities | INT |
| `security_issues` | Security Issues | DATA |
| `software_quality_security_issues` | Security Issues | INT |
| `new_security_issues` | New Security Issues | DATA |
| `new_software_quality_security_issues` | New Security Issues | INT |
| `security_rating` | Security Rating | RATING |
| `software_quality_security_rating` | Security Rating | RATING |
| `new_security_rating` | Security Rating on New Code | RATING |
| `new_software_quality_security_rating` | Security Rating on New Code | RATING |
| `security_remediation_effort` | Security Remediation Effort | WORK_DUR |
| `software_quality_security_remediation_effort` | Security Remediation Effort | WORK_DUR |
| `new_security_remediation_effort` | Security Remediation Effort on New Code | WORK_DUR |
| `new_software_quality_security_remediation_effort` | Security Remediation Effort on New Code | WORK_DUR |

### Security Review（セキュリティレビュー）

| キー | 名前 | 型 |
|------|------|-----|
| `security_hotspots` | Security Hotspots | INT |
| `new_security_hotspots` | New Security Hotspots | INT |
| `security_hotspots_reviewed` | Security Hotspots Reviewed | PERCENT |
| `new_security_hotspots_reviewed` | Security Hotspots Reviewed on New Code | PERCENT |
| `security_review_rating` | Security Review Rating | RATING |
| `new_security_review_rating` | Security Review Rating on New Code | RATING |
| `security_hotspots_reviewed_status` | Security Review Reviewed Status | INT (hidden) |
| `new_security_hotspots_reviewed_status` | Security Review Reviewed Status on New Code | INT (hidden) |
| `security_hotspots_to_review_status` | Security Review To Review Status | INT (hidden) |
| `new_security_hotspots_to_review_status` | Security Review To Review Status on New Code | INT (hidden) |

### Maintainability（保守性）

| キー | 名前 | 型 |
|------|------|-----|
| `code_smells` | Code Smells | INT |
| `new_code_smells` | New Code Smells | INT |
| `sqale_rating` | Maintainability Rating | RATING |
| `software_quality_maintainability_rating` | Maintainability Rating | RATING |
| `new_maintainability_rating` | Maintainability Rating on New Code | RATING |
| `new_software_quality_maintainability_rating` | Maintainability Rating on New Code | RATING |
| `sqale_index` | Technical Debt | WORK_DUR |
| `software_quality_maintainability_remediation_effort` | Technical Debt | WORK_DUR |
| `new_technical_debt` | Added Technical Debt | WORK_DUR |
| `new_software_quality_maintainability_remediation_effort` | Added Technical Debt | WORK_DUR |
| `sqale_debt_ratio` | Technical Debt Ratio | PERCENT |
| `software_quality_maintainability_debt_ratio` | Technical Debt Ratio | PERCENT |
| `new_sqale_debt_ratio` | Technical Debt Ratio on New Code | PERCENT |
| `new_software_quality_maintainability_debt_ratio` | Technical Debt Ratio on New Code | PERCENT |
| `effort_to_reach_maintainability_rating_a` | Effort to Reach Maintainability Rating A | WORK_DUR |
| `effort_to_reach_software_quality_maintainability_rating_a` | Effort to Reach Maintainability Rating A | WORK_DUR |
| `maintainability_issues` | Maintainability Issues | DATA |
| `software_quality_maintainability_issues` | Maintainability Issues | INT |
| `new_maintainability_issues` | New Maintainability Issues | DATA |
| `new_software_quality_maintainability_issues` | New Maintainability Issues | INT |
| `development_cost` | Development Cost | STRING (hidden) |
| `new_development_cost` | Development Cost on New Code | FLOAT (hidden) |

### Coverage（テスト・カバレッジ）

| キー | 名前 | 型 |
|------|------|-----|
| `coverage` | Coverage | PERCENT |
| `new_coverage` | Coverage on New Code | PERCENT |
| `line_coverage` | Line Coverage | PERCENT |
| `new_line_coverage` | Line Coverage on New Code | PERCENT |
| `branch_coverage` | Condition Coverage | PERCENT |
| `new_branch_coverage` | Condition Coverage on New Code | PERCENT |
| `lines_to_cover` | Lines to Cover | INT |
| `new_lines_to_cover` | Lines to Cover on New Code | INT |
| `conditions_to_cover` | Conditions to Cover | INT |
| `new_conditions_to_cover` | Conditions to Cover on New Code | INT |
| `uncovered_lines` | Uncovered Lines | INT |
| `new_uncovered_lines` | Uncovered Lines on New Code | INT |
| `uncovered_conditions` | Uncovered Conditions | INT |
| `new_uncovered_conditions` | Uncovered Conditions on New Code | INT |
| `tests` | Unit Tests | INT |
| `test_errors` | Unit Test Errors | INT |
| `test_failures` | Unit Test Failures | INT |
| `test_success_density` | Unit Test Success (%) | PERCENT |
| `skipped_tests` | Skipped Unit Tests | INT |
| `test_execution_time` | Unit Test Duration | MILLISEC |
| `executable_lines_data` | executable_lines_data | DATA (hidden) |

### Duplications（重複）

| キー | 名前 | 型 |
|------|------|-----|
| `duplicated_blocks` | Duplicated Blocks | INT |
| `new_duplicated_blocks` | Duplicated Blocks on New Code | INT |
| `duplicated_files` | Duplicated Files | INT |
| `duplicated_lines` | Duplicated Lines | INT |
| `new_duplicated_lines` | Duplicated Lines on New Code | INT |
| `duplicated_lines_density` | Duplicated Lines (%) | PERCENT |
| `new_duplicated_lines_density` | Duplicated Lines (%) on New Code | PERCENT |
| `duplications_data` | Duplication Details | DATA |

### Complexity（複雑度）

| キー | 名前 | 型 |
|------|------|-----|
| `complexity` | Cyclomatic Complexity | INT |
| `cognitive_complexity` | Cognitive Complexity | INT |

### Size（規模）

| キー | 名前 | 型 |
|------|------|-----|
| `ncloc` | Lines of Code | INT |
| `lines` | Lines | INT |
| `statements` | Statements | INT |
| `files` | Files | INT |
| `classes` | Classes | INT |
| `functions` | Functions | INT |
| `comment_lines` | Comment Lines | INT |
| `comment_lines_density` | Comments (%) | PERCENT |
| `generated_lines` | Generated Lines | INT |
| `generated_ncloc` | Generated Lines of Code | INT |
| `new_lines` | New Lines | INT |
| `projects` | Project branches | INT |
| `ncloc_language_distribution` | Lines of Code Per Language | DATA |
| `comment_lines_data` | comment_lines_data | DATA (hidden) |
| `ncloc_data` | ncloc_data | DATA (hidden) |
| `unanalyzed_c` | Number of unanalyzed c files | INT (hidden) |
| `unanalyzed_cpp` | Number of unanalyzed c++ files | INT (hidden) |

### Releasability / General

| キー | 名前 | 型 |
|------|------|-----|
| `alert_status` | Quality Gate Status | LEVEL |
| `quality_gate_details` | Quality Gate Details | DATA |
| `quality_profiles` | Profiles | DATA (hidden) |
| `last_commit_date` | Date of Last Commit | MILLISEC (hidden) |

### Documentation（ドキュメント、多くは hidden）

| キー | 名前 | 型 |
|------|------|-----|
| `public_api` | Public API | INT (hidden) |
| `public_documented_api_density` | Public Documented API (%) | PERCENT (hidden) |
| `public_undocumented_api` | Public Undocumented API | INT (hidden) |

---

## miyulab-fe — 主要メトリクス値（2026-05-27）

| メトリクス | 値 | 評価 |
|-----------|-----|------|
| Quality Gate (`alert_status`) | OK | 条件未設定のため常に OK |
| Lines of Code (`ncloc`) | 87,338 | — |
| Issues (`violations` / `open_issues`) | 2,860 | 要改善 |
| Bugs (`bugs`) | 129 | 要改善 |
| Vulnerabilities (`vulnerabilities`) | 0 | 良好 |
| Code Smells (`code_smells`) | 2,731 | 要改善 |
| Blocker Issues (`blocker_violations`) | 7 | 要改善 |
| Critical Issues (`critical_violations`) | 1,362 | 要改善 |
| Coverage (`coverage` / `line_coverage`) | 0.0% | 要改善 |
| Duplicated Lines (`duplicated_lines_density`) | 31.4% | 要改善（目安 3% 未満） |
| Technical Debt (`sqale_index`) | 24,031 分（約 400 時間） | 要改善 |
| Maintainability Rating (`sqale_rating`) | 1.0 (A) | 良好 |
| Reliability Rating (`reliability_rating`) | 5.0 (E) | 要改善 |
| Security Rating (`security_rating`) | 1.0 (A) | 良好 |
| Security Review Rating (`security_review_rating`) | 5.0 (E) | 要改善 |
| Security Hotspots (`security_hotspots`) | 40（レビュー済 0%） | 要改善 |
| Cyclomatic Complexity (`complexity`) | 17,191 | 高い |
| Cognitive Complexity (`cognitive_complexity`) | 48,339 | 高い |

レーティングは **1.0 = A（最良）〜 5.0 = E（最悪）** です。

---

## 問題のある値を示すメトリクス（優先度順）

Quality Gate は **OK** ですが、デフォルトの「Sonar way」ゲートに **条件が 1 件も設定されていない** ため、下記の悪化はゲートでは検知されません。

### 最優先（レーティング E またはゼロ）

1. **`reliability_rating` / `software_quality_reliability_rating` = 5.0 (E)** — バグ 129 件により信頼性が最悪評価。
2. **`security_review_rating` = 5.0 (E)** — セキュリティホットスポット 40 件が **レビュー済み 0%**（`security_hotspots_reviewed` = 0.0%）。
3. **`coverage` / `line_coverage` = 0.0%** — 単体テストカバレッジが SonarQube に取り込まれていない（CI でテスト＋カバレッジレポート未連携の可能性）。

### 高（しきい値を大きく超過）

4. **`duplicated_lines_density` = 31.4%** — 重複行率が高い（Sonar 推奨はおおむね 3% 未満）。`duplicated_lines` = 36,391 行、`duplicated_blocks` = 280。
5. **`blocker_violations` / `software_quality_blocker_issues` = 7** — ブロッカー級イシューが残存。
6. **`bugs` = 129** — 信頼性イシューの直接原因。
7. **`violations` / `open_issues` = 2,860** — 未解決イシュー総数が多い（内訳: Critical 1,362 / Major 578 / Minor 896 / Info 17）。

### 中（量・負荷が大きい）

8. **`sqale_index`（Technical Debt）= 24,031 分** — 修正見積もりが大きい一方、`sqale_rating` は A（債務比率 `sqale_debt_ratio` = 0.9% は低め）。
9. **`security_hotspots` = 40**（未レビュー）— `security_rating` は A だが、ホットスポットの人手レビューが未実施。
10. **`cognitive_complexity` = 48,339** / **`complexity` = 17,191** — 複雑度の絶対値が高く、保守コスト増の要因。

### 良好なメトリクス（参考）

- `vulnerabilities` = **0**
- `security_rating` / `software_quality_security_rating` = **1.0 (A)**
- `sqale_rating` / `software_quality_maintainability_rating` = **1.0 (A)**

---

## 再取得コマンド例（MCP）

```
search_metrics({ "ps": 500, "p": 1 })
get_component_measures({
  "projectKey": "WakuwakuP_miyulab-fe_4aa1e963-ad00-4ad4-9169-1d86c0671a4d",
  "metricKeys": ["bugs", "coverage", "duplicated_lines_density", "reliability_rating", ...]
})
get_project_quality_gate_status({
  "projectKey": "WakuwakuP_miyulab-fe_4aa1e963-ad00-4ad4-9169-1d86c0671a4d"
})
```

定期取得はリポジトリの SonarQube 自動化（cron）から実行されます。
