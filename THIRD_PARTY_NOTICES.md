# Third-party resources

## Google MediaPipe

`vendor/vision_bundle.mjs` and `wasm/vision_wasm*` contain the MediaPipe Tasks Vision JavaScript/WASM runtime, reused from the existing local gesture application. The JavaScript was bundled for browser ES Module use and retains the FilesetResolver and HandLandmarker exports. The exact upstream package version was not retained in the distribution.

- Upstream: https://github.com/google-ai-edge/mediapipe
- Copyright: The MediaPipe Authors / Google
- License: Apache License 2.0; reproduced in `vendor/LICENSE.mediapipe.txt`.
- Documentation: https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js

`models/hand_landmarker.task` is the Google MediaPipe Hand Landmarker model, reused from the same local application. Model documentation and download information: https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker#models

## Local fonts

`fonts/garden-song-400.woff2` and `fonts/garden-song-600.woff2` were reused from the existing application's local font assets. Its supplied copyright and SIL Open Font License 1.1 text are preserved in `fonts/OFL.txt`.

## Public hand image used in tests

`tests/fixtures/right_hands.jpg` is a Google MediaPipe public test asset. It is used only in recognition tests and simulated-video validation, and is not a user's webcam image.

- Source: https://storage.googleapis.com/mediapipe-assets/right_hands.jpg
- Associated upstream project: https://github.com/google-ai-edge/mediapipe

The application's instrument drawing and audio samples are generated locally; no third-party harp photograph or recorded instrument sample is used.
