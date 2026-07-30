# Contributing to Twenty CRM MCP Server

Thank you for your interest in contributing! This project aims to provide the best possible integration between Twenty CRM and MCP-compatible AI assistants.

## Maintenance status

This project is **community-supported**. The maintainer no longer runs Twenty day-to-day, so real-world reports and PRs from active Twenty users are especially valuable — you are the ones who see API changes first. Well-tested PRs get reviewed and merged; if you rely on this server heavily and want to help maintain it, open an issue and say so.

## Development Setup

1. **Fork and clone the repository**:
```bash
git clone https://github.com/your-username/twenty-crm-mcp-server.git
cd twenty-crm-mcp-server
```

2. **Install dependencies**:
```bash
npm install
```

3. **Run the tests** (no API key or network needed):
```bash
npm test
```

4. **To run against a real workspace**, set up environment variables:
```bash
cp .env.example .env
```
Edit `.env` with your Twenty CRM API key and base URL, then `npm start`.

## How to Contribute

### Reporting Issues

Before creating an issue, please:

1. **Search existing issues** to avoid duplicates
2. **Use the issue templates** provided
3. **Include relevant details**:
   - Twenty CRM version (cloud/self-hosted)
   - Node.js version
   - Error messages and stack traces
   - Steps to reproduce

### Suggesting Features

We welcome feature suggestions! Please:

1. **Check the roadmap** to see if it's already planned
2. **Open a discussion** before submitting large features
3. **Explain the use case** and expected behavior
4. **Consider backward compatibility**

### Code Contributions

#### Before You Start

1. **Open an issue** to discuss your proposed changes
2. **Check if someone is already working** on similar functionality
3. **Review the codebase** to understand the patterns used

#### Development Guidelines

**Code Style**:
- Use ES modules (`import`/`export`)
- Follow existing naming conventions
- Add JSDoc comments for new functions
- Keep functions focused and small

**Error Handling**:
- Always handle API errors gracefully
- Provide helpful error messages to users
- Log errors with appropriate context

**Testing**:
- Add unit tests for new functionality (`test/` — they run with `node --test`, no network)
- Ensure existing tests pass
- Verify behavior against a real Twenty instance when you can, and say in the PR which Twenty version you tested against — the REST API changes between versions (e.g. `annualRecurringRevenue` → `annualRevenue` in v2.x)

#### Pull Request Process

1. **Create a feature branch**:
```bash
git checkout -b feature/your-feature-name
```

2. **Make your changes**:
   - Follow the coding guidelines above
   - Add tests for new functionality
   - Update documentation as needed

3. **Test thoroughly**:
```bash
npm test
```

4. **Commit with clear messages**:
```bash
git commit -m "feat: add support for custom field types"
```

Use conventional commit format:
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `refactor:` for code refactoring
- `test:` for test additions/modifications

5. **Push and create PR**:
```bash
git push origin feature/your-feature-name
```

Then create a pull request with:
- **Clear title and description**
- **Reference any related issues**
- **Include testing instructions**
- **Update CHANGELOG.md** if applicable

#### Review Process

- PRs are reviewed on a best-effort basis (see maintenance status above)
- CI must pass (`npm test` on Node 18/20/22)
- Address feedback promptly
- Keep PRs focused and reasonably sized

## Roadmap

### Ideas for future work

- **Generic custom-object tools**: CRUD for any object discovered via metadata
- **Schema-aware field normalization**: map composite fields by type from `/rest/metadata/objects` instead of by hardcoded name
- **Streamable HTTP transport**: optional remote-hosting entrypoint alongside stdio
- **Upserts / duplicate detection**: via Twenty's `/rest/*/duplicates` endpoint
- **TypeScript Support**: full type definitions

### Areas for Contribution

- **Documentation**: Improve examples and tutorials
- **Testing**: Add integration tests and edge cases
- **Performance**: Optimize API calls and response handling
- **Features**: Implement items from the roadmap
- **Bug Fixes**: Address issues and improve stability

## Code of Conduct

### Our Standards

- **Be respectful** and inclusive
- **Focus on constructive feedback**
- **Help others learn and grow**
- **Assume good intentions**

### Unacceptable Behavior

- Harassment or discrimination
- Trolling or inflammatory comments
- Personal attacks
- Publishing private information

## Getting Help

- **GitHub Discussions**: For questions and general discussion
- **Issues**: For bug reports and feature requests
- **Discord**: Join the Twenty CRM community

## Recognition

Contributors will be:
- **Listed in README.md**
- **Credited in release notes**
- **Invited to the contributors team** (for regular contributors)

Thank you for helping make this project better! 🚀