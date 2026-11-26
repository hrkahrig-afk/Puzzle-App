# Puzzle Box for Android

A small Android app (Capacitor) that loads the live game from
https://hrkahrig-afk.github.io/Puzzle-App/. Because the game is loaded from the
site, game updates arrive automatically; this app only needs rebuilding when the
app shell itself changes.

Why an app: saves live in the app's own storage, which Android doesn't clear to
free space, and the game also writes `Documents/PuzzleBox/puzzle-box-save.txt`.

## Builds
`.github/workflows/android.yml` builds a signed APK and publishes it as the
`android-latest` release. It needs two repository secrets (Settings → Secrets and
variables → Actions): `KEYSTORE_B64` and `KEYSTORE_PASSWORD`. Every build must be
signed with the same key, or Android won't install it over the previous version.
