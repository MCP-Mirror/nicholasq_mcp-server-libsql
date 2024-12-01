# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.2] - 2024-03-XX

### Added
- Support for @libsql/client v0.14.0
- Command line argument parsing with @std/cli
- Debug logging functionality
- New prompts: `libsql-schema` and `libsql-query`
- New tool: `query` for running read-only SQL queries
- CSV export functionality
- Logger utility functions

### Changed
- Switched from command line Turso CLI to @libsql/client
- Improved error handling
- Updated server version from 0.0.1 to 0.0.2
- Refactored code structure

### Fixed
- Input validation for table names
- Database connection handling

[0.0.2]: https://github.com/nicholasq/mcp-server-libsql/compare/v0.0.1...v0.0.2
