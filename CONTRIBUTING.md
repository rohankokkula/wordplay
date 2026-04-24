# Contributing to Wordplay

Thanks for your interest in contributing! Here's how to get started.

## Getting Started

1. **Fork** the repository
2. **Clone** your fork:
   ```bash
   git clone https://github.com/<your-username>/wordplay-render.git
   cd wordplay-render
   ```
3. **Create a branch** for your change:
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. **Set up** both frontend and backend (see [README.md](README.md#quick-start))

## Development

### Frontend

```bash
npm install
npm run dev       # Vite dev server at http://localhost:5173
npm run lint      # ESLint
npm run build     # Production build
```

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Code Style

- **TypeScript**: Follow the existing ESLint config. Run `npm run lint` before committing.
- **Python**: Follow PEP 8. Keep functions focused and well-documented.
- **Comments**: Only for non-obvious logic. Don't narrate what code does — explain *why*.

## Commit Messages (Conventional Commits)

Wordplay uses [release-please](https://github.com/googleapis/release-please) for automated semantic versioning and changelogs. **Every commit merged to `main` must follow [Conventional Commits](https://www.conventionalcommits.org/)**:

| Prefix      | Meaning                            | Version bump |
| ----------- | ---------------------------------- | ------------ |
| `feat:`     | User-visible feature               | **minor**    |
| `fix:`      | User-visible bug fix               | **patch**    |
| `perf:`     | Performance improvement            | **patch**    |
| `refactor:` | Internal change, no behavior diff  | none         |
| `docs:`     | Docs only                          | none         |
| `chore:`    | Tooling / infra                    | none         |
| `feat!:`    | Breaking change (add `!` anywhere) | **major**    |

Example: `feat(mix): add ReactFlow node canvas with FX-colored edges`

On every merge to `main`, release-please either bumps a queued release PR or opens a new one that writes `CHANGELOG.md`, tags `vX.Y.Z`, and publishes a GitHub Release.

## Pull Requests

1. Keep PRs focused on a single change
2. Update documentation if your change affects the public API or setup steps
3. Ensure `npm run build` and `npm run lint` pass
4. Test your changes locally with both frontend and backend running
5. Write a clear PR description explaining what and why

## Reporting Issues

- Use GitHub Issues
- Include steps to reproduce
- Include browser/OS/Node/Python version info
- Attach console errors or screenshots when relevant

## Ideas for Contributions

- Additional genre presets and beat patterns
- Improved beat detection algorithms
- Mobile UI polish
- Additional audio effects
- Support for more lyrics providers
- Internationalization (i18n)
- Unit tests for audio analysis and automix logic

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
