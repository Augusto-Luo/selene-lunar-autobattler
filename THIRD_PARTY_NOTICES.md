# Third-party notices

No project-wide license has been selected for SELENE. This file records dependency licenses and does not relicense the game source.

## three.js

The public game bundle includes three.js and its example modules (including OrbitControls and RoomEnvironment). The verified runtime version is 0.186.1.

Upstream: https://github.com/mrdoob/three.js

The following license is reproduced from the installed three.js package:

```text
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Development dependencies

These packages are installed by `npm ci` and are not included in the source ZIP:

| Dependency | Verified version | License |
| --- | --- | --- |
| @types/three | 0.186.0 | MIT |
| TypeScript | 7.0.2 | Apache-2.0 |
| Vite | 8.3.4 | MIT, with separate notices for its bundled dependencies |

Transitive dependencies and platform-specific optional packages retain their own licenses. The lockfile records package provenance; complete license and notice files are included in the packages installed by npm.
