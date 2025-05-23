// MIT License

// Copyright (c) 2019 Zachary Rice

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

package sources

import (
	"io/fs"
	"os"
	"path/filepath"
	"runtime"

	"github.com/fatih/semgroup"

	"github.com/Infisical/infisical-merge/detect/config"
	"github.com/Infisical/infisical-merge/detect/logging"
)

type ScanTarget struct {
	Path    string
	Symlink string
}

var isWindows = runtime.GOOS == "windows"

func DirectoryTargets(source string, s *semgroup.Group, followSymlinks bool, allowlists []*config.Allowlist) (<-chan ScanTarget, error) {
	paths := make(chan ScanTarget)
	s.Go(func() error {
		defer close(paths)
		return filepath.Walk(source,
			func(path string, fInfo os.FileInfo, err error) error {
				logger := logging.With().Str("path", path).Logger()

				if err != nil {
					if os.IsPermission(err) {
						// This seems to only fail on directories at this stage.
						logger.Warn().Msg("Skipping directory: permission denied")
						return filepath.SkipDir
					}
					return err
				}

				// Empty; nothing to do here.
				if fInfo.Size() == 0 {
					return nil
				}

				// Unwrap symlinks, if |followSymlinks| is set.
				scanTarget := ScanTarget{
					Path: path,
				}
				if fInfo.Mode().Type() == fs.ModeSymlink {
					if !followSymlinks {
						logger.Debug().Msg("Skipping symlink")
						return nil
					}

					realPath, err := filepath.EvalSymlinks(path)
					if err != nil {
						return err
					}

					realPathFileInfo, _ := os.Stat(realPath)
					if realPathFileInfo.IsDir() {
						logger.Warn().Str("target", realPath).Msg("Skipping symlinked directory")
						return nil
					}

					scanTarget.Path = realPath
					scanTarget.Symlink = path
				}

				// TODO: Also run this check against the resolved symlink?
				var skip bool
				for _, a := range allowlists {
					skip = a.PathAllowed(path) ||
						// TODO: Remove this in v9.
						// This is an awkward hack to mitigate https://github.com/gitleaks/gitleaks/issues/1641.
						(isWindows && a.PathAllowed(filepath.ToSlash(path)))
					if skip {
						break
					}
				}
				if fInfo.IsDir() {
					// Directory
					if skip {
						logger.Debug().Msg("Skipping directory due to global allowlist")
						return filepath.SkipDir
					}

					if fInfo.Name() == ".git" {
						// Don't scan .git directories.
						// TODO: Add this to the config allowlist, instead of hard-coding it.
						return filepath.SkipDir
					}
				} else {
					// File
					if skip {
						logger.Debug().Msg("Skipping file due to global allowlist")
						return nil
					}

					paths <- scanTarget
				}
				return nil
			})
	})
	return paths, nil
}
