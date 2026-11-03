# Third-party notices

Meldmind (an Everborn product, by Everborn Productions) includes or downloads the third-party software and models listed below. Each one stays under its own licence. This file ships with the app (inside the app and in the `resources` folder next to Meldmind.exe).

## Natural voice (Settings > Voice)

The natural voice runs on this computer. The voice model is not in the installer: it downloads once, from Hugging Face, only when you click "Get the natural voice".

### Kokoro-82M (voice model)

- Licence: Apache License 2.0
- Author: hexgrad
- Model: https://huggingface.co/hexgrad/Kokoro-82M
- ONNX build Meldmind downloads: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX (revision 1939ad2a8e416c0acfeecc08a694d14ef25f2231, file `onnx/model_quantized.onnx`)
- The six voice files offered in Settings > Voice (af_heart, af_bella, bf_emma, am_michael, am_fenrir, bm_george) come with kokoro-js under the same licence.

### kokoro-js 1.2.1

- Licence: Apache License 2.0
- Author: hexgrad
- Source: https://github.com/hexgrad/kokoro
- Package: https://www.npmjs.com/package/kokoro-js

### phonemizer 1.2.1 (bundles eSpeak NG)

- Licence of the phonemizer package code: Apache License 2.0
- Author: Xenova (Joshua Lochner)
- Source: https://github.com/xenova/phonemizer.js
- The package bundles a WebAssembly build of **eSpeak NG** and its language data, which turns text into speech sounds for the voice model.
- eSpeak NG licence: GNU General Public License, version 3 or later (GPL-3.0-or-later). Licence text: https://www.gnu.org/licenses/gpl-3.0.html
- eSpeak NG source code: https://github.com/espeak-ng/espeak-ng
- The corresponding source for the bundled build is the phonemizer.js repository above together with the eSpeak NG source.

### Libraries the natural voice loads

| Package | Licence | Source |
| --- | --- | --- |
| @huggingface/transformers 3.8.1 | Apache-2.0 | https://github.com/huggingface/transformers.js |
| @huggingface/jinja | MIT | https://github.com/huggingface/huggingface.js |
| onnxruntime-node and onnxruntime-common 1.21.0 | MIT | https://github.com/microsoft/onnxruntime |
| sharp 0.34.5 | Apache-2.0 | https://github.com/lovell/sharp |
| @img/sharp-win32-x64 (sharp binary plus the libvips DLLs) | Apache-2.0 (sharp) and LGPL-3.0-or-later (libvips) | https://github.com/lovell/sharp-libvips and https://github.com/libvips/libvips |
| protobufjs and @protobufjs/* | BSD-3-Clause | https://github.com/protobufjs/protobuf.js |
| flatbuffers | Apache-2.0 | https://github.com/google/flatbuffers |
| long | Apache-2.0 | https://github.com/dcodeIO/long.js |
| detect-libc | Apache-2.0 | https://github.com/lovell/detect-libc |
| guid-typescript | ISC | https://github.com/NicolasDeveloper/guid-typescript |
| platform | MIT | https://github.com/bestiejs/platform.js |
| @img/colour | MIT | https://github.com/lovell/colour |

libvips is a separate shared library loaded at run time, so it can be replaced with another build of the same version.

## Licence texts

- Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
- GNU GPL version 3: https://www.gnu.org/licenses/gpl-3.0.html
- GNU LGPL version 3: https://www.gnu.org/licenses/lgpl-3.0.html
- MIT, ISC and BSD-3-Clause: the text is in each package's LICENSE file inside the app.
