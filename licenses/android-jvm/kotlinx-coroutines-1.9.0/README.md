# kotlinx.coroutines 1.9.0 scoped Android notice materials

This directory imports only two complete upstream notice/license texts, unchanged.
It imports no implementation, binary, new dependency, signature or secret.

## Exact provenance and source-file review

Upstream Kotlin/kotlinx.coroutines tag `1.9.0` resolved to commit
`d8d6f8f37978b8e202d93b34f23f101df9c5724d`. The source archive read at that
fixed commit has SHA256
`a1094a56fc9bcca400806ec3b0f2f6eb1e7d943b801ab91650ae63cae3e419ce`.

| Imported file | Original path in that commit | Exact raw SHA256 |
| --- | --- | --- |
| LICENSE.txt | LICENSE.txt | b1febe6399dffb10d19d35e7663ab16300c93cb0476a94115df1cc0097a8ffd8 |
| NOTICE.txt | license/NOTICE.txt | 421d45acbd92670b4131621a28fcbb41ba0b747d3a336cb13fca38c0685426c4 |

Immutable upstream addresses:

- https://github.com/Kotlin/kotlinx.coroutines/blob/d8d6f8f37978b8e202d93b34f23f101df9c5724d/LICENSE.txt
- https://github.com/Kotlin/kotlinx.coroutines/blob/d8d6f8f37978b8e202d93b34f23f101df9c5724d/license/NOTICE.txt

The complete LICENSE was read, including Apache-2.0 sections 4(a)-(d), its
JetBrains/Kotlin contributor copyright and warranty terms. NOTICE was separately
read in full: the kotlinx.coroutines attribution and 2016-2024 JetBrains and
contributors copyright are preserved. Apache-2.0 is compatible with this
project's GPL-3.0-only terms; the original notice obligations remain in force.

Actual Maven source archives from completed Android build run `40203694867`
were bound to that run's original input-inventory hashes, not just POM names:

| Component | Source JAR bytes | Source JAR SHA256 | Original source-file observations |
| --- | --- | --- | --- |
| org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0 | 327913 | abd6b4a8588f6117f4ed2787c4ec7b2f9c25daa403b3b4bbcf26fa4e0a725398 | 159 Kotlin files; each has an exact byte-identical file in the fixed upstream archive |
| org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.9.0 | 396314 | 01e0f26a274d8f2f2ae702b161bc0980cea817bfcaf66ca4944434ea7b601771 | 167 Kotlin files; each has an exact byte-identical file in that archive |

This is read-only source-material review, not an Android build or runtime test.
The Maven source JARs omit named LICENSE/NOTICE files and most files have no
leading comment. That absence was checked against the actual files, not filled
with invented headers or inferred from Maven metadata. Reading the source marker
lines found no additional copyright/license grant in these source-file sets;
ordinary documentation saying "derived from" an interface is not a separate grant.
The applicable upstream source-distribution license and NOTICE accompany these
byte-corresponding files. This does not establish final DEX retention or cover
Kotlin stdlib, other JVM libraries,
generated sources or third-party native code.

## Delivery boundary

The Android-only Tauri resource map includes these two files. The final APK
inspector requires the current non-fixture Android runtime inventory, exact
reviewed component versions/source hashes, exact pinned notice source hashes,
and one byte-identical APK member for each text. It rejects changed graphs,
stale/synthetic reports, changed notice source, missing/duplicate members and
substitution. Negative fixtures keep other required resources valid so an
unrelated missing file cannot make a broken guard appear successful.

Passing controls is not proof of actual APK delivery. Only the final actual
APK audit can set the scoped supplemental-resource delivery flag. Runtime
readability, complete per-file dependency review, corresponding source,
distributability, installation and S25 Ultra acceptance remain separate and
unproven. No public release or signing approval is implied.

## Android dispatcher source correspondence

The actual Android inventory from run `40213560125`, revision
`6ed6ac0c420cbd79d07d5accfe6d4805cdbc1bc5`, also resolves
`org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0`. Its Maven Central source
JAR is 7,783 bytes, SHA256
`dd4d70dbc424eb0492126446b4035821d40d255664a8a36091d357f11390bc50`.

Read-only comparison with the same fixed upstream archive above found all nine
non-manifest files byte-identical to upstream: `AndroidExceptionPreHandler.kt`,
`HandlerDispatcher.kt`, `module-info.java`, four `coroutines.pro` files and the
two service-provider declarations. The manifest contains only
`Manifest-Version: 1.0`; no upstream byte match was established for that generated
manifest. No source headers were invented or changed. The source and resource
files were read; this archive contains no separate LICENSE or NOTICE entry.

The existing two original upstream license/notice texts remain the delivered
materials; this change imports no new implementation or legal text. The APK
supplemental-resource check now additionally binds this exact Android component
and source hash, refusing an unresolved, changed or upgraded source rather than
silently reusing this review. That is a source-correspondence boundary, not full
per-file licensing approval, final DEX/source correspondence, manifest audit,
Android execution or permission to distribute a signed APK.