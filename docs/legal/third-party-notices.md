# Third-party notices

Meldmind is an Everborn product by Everborn Productions. The app itself is proprietary software (package.json license: UNLICENSED). It includes open source software written by other people. This file lists that software, who wrote it, and the license it comes with, so the notices travel with the app.

How this list was made: from the dependencies named in package.json and the exact versions locked in package-lock.json for Meldmind 0.4.22 (checked 2026-10-27). In a clean folder with only those two files, `npm ci --omit=dev --ignore-scripts` installed the packages, and each package's own package.json and license file were read for the license and the copyright line. Nothing here was guessed from memory. When a dependency changes, this file has to be regenerated the same way.

Each package keeps its own license file inside the installed app (in node_modules). This page is a summary, not a replacement for those files.

## 1. Direct dependencies that ship in the app

These are the packages Meldmind asks for by name in package.json `dependencies`.

| Package | Version | License | What Meldmind uses it for |
|---|---|---|---|
| @anthropic-ai/sdk | 0.80.0 | MIT | Talking to Claude with your Anthropic key |
| electron-updater | 6.8.9 | MIT | Update checks and downloads from the public releases page |
| isomorphic-git | 1.44.3 | MIT | Versioned forks inside Remix projects (no network) |
| qrcode-generator | 2.0.4 | MIT | The phone pairing QR code |
| undici | 7.30.1 | MIT | Local request handling (the loopback fetch agent in server/loopback-fetch.js) |
| ws | 8.22.0 | MIT | The app's local WebSocket server (server/index.js) |

## 2. Browser helper add-on (not in the installer)

| Package | Version | License | Note |
|---|---|---|---|
| playwright-core | 1.64.1 | Apache-2.0 | Listed in package.json `optionalDependencies`. electron-builder.yml leaves playwright and playwright-core out of the installer, and Meldmind only loads it when it is present (server/app-drivers.js). Its NOTICE file (Copyright (c) Microsoft Corporation, with code derived from the Puppeteer project, Apache-2.0) has to travel with it if it is ever shipped. |

## 3. Electron runtime

The installer bundles Electron (package.json devDependencies, version 44.9.0, MIT License, Copyright (c) Electron contributors and GitHub Inc.). Electron contains Chromium and Node.js, each with its own licenses. Electron's own download includes a LICENSE file and LICENSES.chromium.html, which list those licenses. They sit next to the app files in the installed folder. https://www.electronjs.org/ and https://github.com/electron/electron.

## 4. Everything else that ships (indirect dependencies)

80 packages ship in total: the 6 direct ones above plus 74 that they pull in. Counts by license: MIT 68, ISC 5, Apache-2.0 2, Python-2.0 1, BSD-3-Clause 1, (MIT AND Zlib) 1, BlueOak-1.0.0 1, (MIT AND BSD-3-Clause) 1. No GPL, AGPL or LGPL license is listed by any of them.

| Package | Version | License | Copyright or author | Source |
|---|---|---|---|---|
| @babel/runtime | 7.29.10 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | https://github.com/babel/babel |
| abort-controller | 3.0.0 | MIT | Copyright (c) 2017 Toru Nagashima | https://github.com/mysticatea/abort-controller |
| argparse | 2.0.1 | Python-2.0 | Copyright (c) 1991 - 1995, Stichting Mathematisch Centrum Amsterdam, | https://github.com/nodeca/argparse |
| async-lock | 1.4.1 | MIT | Copyright (c) 2016 Rogier Schouten <github@workingcode.ninja> | https://github.com/rogierschouten/async-lock |
| available-typed-arrays | 1.0.7 | MIT | Copyright (c) 2020 Inspect JS | https://github.com/inspect-js/available-typed-arrays |
| base64-js | 1.5.1 | MIT | Copyright (c) 2014 Jameson Little | https://github.com/beatgammit/base64-js |
| buffer | 6.0.3 | MIT | Copyright (c) Feross Aboukhadijeh, and other contributors. | https://github.com/feross/buffer |
| builder-util-runtime | 9.7.0 | MIT | Copyright (c) 2015 Loopline Systems | https://github.com/electron-userland/electron-builder |
| call-bind | 1.0.9 | MIT | Copyright (c) 2020 Jordan Harband | https://github.com/ljharb/call-bind |
| call-bind-apply-helpers | 1.0.2 | MIT | Copyright (c) 2024 Jordan Harband | https://github.com/ljharb/call-bind-apply-helpers |
| call-bound | 1.0.4 | MIT | Copyright (c) 2024 Jordan Harband | https://github.com/ljharb/call-bound |
| clean-git-ref | 2.0.1 | Apache-2.0 | Eli White (author field; the package ships no license file) | https://github.com/TheSavior/clean-git-ref |
| crc-32 | 1.2.2 | Apache-2.0 | copyright notice that is included in or attached to the work | https://github.com/SheetJS/js-crc32 |
| debug | 4.4.3 | MIT | Copyright (c) 2014-2017 TJ Holowaychuk <tj@vision-media.ca> | https://github.com/debug-js/debug |
| decompress-response | 6.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) | https://github.com/sindresorhus/decompress-response |
| define-data-property | 1.1.4 | MIT | Copyright (c) 2023 Jordan Harband | https://github.com/ljharb/define-data-property |
| diff3 | 0.0.3 | MIT | Tyler Wanek (author field; the package ships no license file) | https://github.com/axosoft/diff3 |
| dunder-proto | 1.0.1 | MIT | Copyright (c) 2024 ECMAScript Shims | https://github.com/es-shims/dunder-proto |
| es-define-property | 1.0.1 | MIT | Copyright (c) 2024 Jordan Harband | https://github.com/ljharb/es-define-property |
| es-errors | 1.3.0 | MIT | Copyright (c) 2024 Jordan Harband | https://github.com/ljharb/es-errors |
| es-object-atoms | 1.1.2 | MIT | Copyright (c) 2024 Jordan Harband | https://github.com/ljharb/es-object-atoms |
| event-target-shim | 5.0.1 | MIT | Copyright (c) 2015 Toru Nagashima | https://github.com/mysticatea/event-target-shim |
| events | 3.3.0 | MIT | Copyright Joyent, Inc. and other Node contributors. | https://github.com/Gozala/events |
| for-each | 0.3.5 | MIT | Copyright (c) 2012 Raynos. | https://github.com/Raynos/for-each |
| fs-extra | 10.1.0 | MIT | Copyright (c) 2011-2017 JP Richardson | https://github.com/jprichardson/node-fs-extra |
| function-bind | 1.1.2 | MIT | Copyright (c) 2013 Raynos. | https://github.com/Raynos/function-bind |
| get-intrinsic | 1.3.0 | MIT | Copyright (c) 2020 Jordan Harband | https://github.com/ljharb/get-intrinsic |
| get-proto | 1.0.1 | MIT | Copyright (c) 2025 Jordan Harband | https://github.com/ljharb/get-proto |
| gopd | 1.2.0 | MIT | Copyright (c) 2022 Jordan Harband | https://github.com/ljharb/gopd |
| graceful-fs | 4.2.11 | ISC | Copyright (c) 2011-2022 Isaac Z. Schlueter, Ben Noordhuis, and Contributors | https://github.com/isaacs/node-graceful-fs |
| has-property-descriptors | 1.0.2 | MIT | Copyright (c) 2022 Inspect JS | https://github.com/inspect-js/has-property-descriptors |
| has-symbols | 1.1.0 | MIT | Copyright (c) 2016 Jordan Harband | https://github.com/inspect-js/has-symbols |
| has-tostringtag | 1.0.2 | MIT | Copyright (c) 2021 Inspect JS | https://github.com/inspect-js/has-tostringtag |
| hasown | 2.0.4 | MIT | Copyright (c) Jordan Harband and contributors | https://github.com/inspect-js/hasOwn |
| ieee754 | 1.2.1 | BSD-3-Clause | Copyright 2008 Fair Oaks Labs, Inc. | https://github.com/feross/ieee754 |
| ignore | 5.3.2 | MIT | Copyright (c) 2013 Kael Zhang <i@kael.me>, contributors | git@github.com:kaelzhang/node-ignore |
| inherits | 2.0.4 | ISC | Copyright (c) Isaac Z. Schlueter | https://github.com/isaacs/inherits |
| is-callable | 1.2.7 | MIT | Copyright (c) 2015 Jordan Harband | https://github.com/inspect-js/is-callable |
| is-typed-array | 1.1.15 | MIT | Copyright (c) 2015 Jordan Harband | https://github.com/inspect-js/is-typed-array |
| isarray | 2.0.5 | MIT | Copyright (c) 2013 Julian Gruber <julian@juliangruber.com> | https://github.com/juliangruber/isarray |
| js-yaml | 4.3.2 | MIT | Copyright (C) 2011-2015 by Vitaly Puzrin | https://github.com/nodeca/js-yaml |
| json-schema-to-ts | 3.1.1 | MIT | Copyright (c) 2020 Thomas Aribart | https://github.com/ThomasAribart/json-schema-to-ts |
| jsonfile | 6.2.1 | MIT | Copyright (c) 2012-2015, JP Richardson <jprichardson@gmail.com> | git@github.com:jprichardson/node-jsonfile |
| lazy-val | 1.0.5 | MIT | Vladimir Krivosheev (author field; the package ships no license file) | https://github.com/develar/lazy-val |
| lodash.escaperegexp | 4.1.2 | MIT | Copyright jQuery Foundation and other contributors <https://jquery.org/> | https://github.com/lodash/lodash |
| lodash.isequal | 4.5.0 | MIT | Copyright JS Foundation and other contributors <https://js.foundation/> | https://github.com/lodash/lodash |
| math-intrinsics | 1.1.0 | MIT | Copyright (c) 2024 ECMAScript Shims | https://github.com/es-shims/math-intrinsics |
| mimic-response | 3.1.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) | https://github.com/sindresorhus/mimic-response |
| minimist | 1.2.8 | MIT | COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | https://github.com/minimistjs/minimist |
| minimisted | 2.0.1 | MIT | Yoshiya Hinosawa (author field; the package ships no license file) | https://github.com/kt3k/minimisted |
| ms | 2.1.3 | MIT | Copyright (c) 2020 Vercel, Inc. | https://github.com/vercel/ms |
| once | 1.4.0 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors | https://github.com/isaacs/once |
| pako | 1.0.11 | (MIT AND Zlib) | Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn | https://github.com/nodeca/pako |
| pify | 4.0.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) | https://github.com/sindresorhus/pify |
| possible-typed-array-names | 1.1.0 | MIT | Copyright (c) 2024 Jordan Harband | https://github.com/ljharb/possible-typed-array-names |
| process | 0.11.10 | MIT | Copyright (c) 2013 Roman Shtylman <shtylman@gmail.com> | https://github.com/shtylman/node-process |
| readable-stream | 4.8.0 | MIT | Copyright Node.js contributors. All rights reserved. | https://github.com/nodejs/readable-stream |
| safe-buffer | 5.2.1 | MIT | Copyright (c) Feross Aboukhadijeh | https://github.com/feross/safe-buffer |
| safe-buffer | 5.2.1 | MIT | Copyright (c) Feross Aboukhadijeh | https://github.com/feross/safe-buffer |
| safe-buffer | 5.2.1 | MIT | Copyright (c) Feross Aboukhadijeh | https://github.com/feross/safe-buffer |
| sax | 1.6.1 | BlueOak-1.0.0 | copyright in it. | https://github.com/isaacs/sax-js |
| semver | 7.7.4 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors | https://github.com/npm/node-semver |
| set-function-length | 1.2.2 | MIT | Copyright (c) Jordan Harband and contributors | https://github.com/ljharb/set-function-length |
| sha.js | 2.4.12 | (MIT AND BSD-3-Clause) | Copyright (c) 2013-2018 sha.js contributors | https://github.com/crypto-browserify/sha.js |
| simple-concat | 1.0.1 | MIT | Copyright (c) Feross Aboukhadijeh | https://github.com/feross/simple-concat |
| simple-get | 4.0.1 | MIT | Copyright (c) Feross Aboukhadijeh | https://github.com/feross/simple-get |
| string_decoder | 1.3.0 | MIT | Copyright Node.js contributors. All rights reserved. | https://github.com/nodejs/string_decoder |
| tiny-typed-emitter | 2.1.0 | MIT | Copyright (c) 2020 Zurab Benashvili (binier) <zura.bena@gmail.com> | https://github.com/binier/tiny-typed-emitter |
| to-buffer | 1.2.2 | MIT | Copyright (c) 2016 Mathias Buus | https://github.com/browserify/to-buffer |
| ts-algebra | 2.0.0 | MIT | Copyright (c) 2020 Thomas Aribart | https://github.com/ThomasAribart/ts-algebra |
| typed-array-buffer | 1.0.3 | MIT | Copyright (c) 2023 Jordan Harband | https://github.com/inspect-js/typed-array-buffer |
| universalify | 2.0.1 | MIT | Copyright (c) 2017, Ryan Zimmerman <opensrc@ryanzim.com> | https://github.com/RyanZim/universalify |
| which-typed-array | 1.1.24 | MIT | Copyright (c) 2015 Jordan Harband | https://github.com/inspect-js/which-typed-array |
| wrappy | 1.0.2 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors | https://github.com/npm/wrappy |

Direct dependencies, with their copyright lines:

| Package | Copyright or author | Source |
|---|---|---|
| @anthropic-ai/sdk | Copyright 2023 Anthropic, PBC. | https://github.com/anthropics/anthropic-sdk-typescript |
| electron-updater | Copyright (c) 2015 Loopline Systems | https://github.com/electron-userland/electron-builder |
| isomorphic-git | Copyright 2017-2023 the 'isomorphic-git' authors | https://github.com/isomorphic-git/isomorphic-git |
| qrcode-generator | Kazuhiko Arase (author field; the package ships no license file) | https://github.com/kazuhikoarase/qrcode-generator |
| undici | Copyright (c) Matteo Collina and Undici contributors | https://github.com/nodejs/undici |
| ws | Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com> | https://github.com/websockets/ws |

## 5. Other bundled material

| Item | License | Where |
|---|---|---|
| Montserrat ExtraBold letter shapes (a pre-drawn glyph atlas used to stamp text onto pictures) | SIL Open Font License 1.1 | server/overlay-font.json. Copyright 2011 The Montserrat Project Authors (https://github.com/JulietaUla/Montserrat). The font name and license are recorded in the file itself. |
| Inter and JetBrains Mono fonts | SIL Open Font License 1.1 | Not bundled. The app page asks Google Fonts for them when it opens (web/index.html, web/share.html). See docs/legal/privacy.md. |

## 6. Dev and build tools (not shipped inside the app)

These are named in package.json `devDependencies` and are used to build the installer or the hosted version. Their code is not part of the app, except Electron (section 3).

| Package | Version | License | Use |
|---|---|---|---|
| electron | 44.9.0 | MIT | Desktop shell (see section 3) |
| electron-builder | 26.15.3 | MIT | Builds the installer |
| pdfkit | 0.20.2 | MIT | Builds the stamped User Guide PDF (scripts/guide-pdf.mjs) |
| @cloudflare/containers | 0.3.7 | MIT OR Apache-2.0 | Hosted worker only (worker/index.js) |

## 7. License texts

The standard texts for the licenses above. Each package's copyright holder is the one named in its own row and its own license file.

### MIT License (applies to the packages marked MIT, and the MIT half of the combined licenses)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### ISC License (graceful-fs, inherits, once, semver, wrappy)

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

### BSD 3-Clause License (ieee754, and the BSD half of sha.js)

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

### Longer licenses, by reference

- Apache License 2.0 (clean-git-ref, crc-32, and playwright-core in the add-on): https://www.apache.org/licenses/LICENSE-2.0.txt. The full text is also in each package's LICENSE file.
- Python Software Foundation License 2.0 (argparse 2.0.1): https://docs.python.org/3/license.html and the package's LICENSE file.
- Blue Oak Model License 1.0.0 (sax 1.6.1): https://blueoakcouncil.org/license/1.0.0
- Zlib License (the Zlib half of pako 1.0.11): https://zlib.net/zlib_license.html
- SIL Open Font License 1.1 (Montserrat): https://openfontlicense.org/open-font-license-official-text/

## 8. Keeping this file true

- Regenerate it whenever package.json or package-lock.json changes a dependency.
- Production dependency licenses only. Services the app calls over the internet (AI companies, Supabase, GitHub and others) are not code in the app and are listed in docs/legal/privacy.md instead.
- This file is a plain-words summary and is not legal advice.
