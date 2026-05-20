# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] 

## [2.0.0] - 2026-05-20

### Added
- feat: Phase 0 & 1: Foundation for v2.0.0 HTTP Platform Support #10
- feat: implement HTTP request body parsing (Phase 2) #12
- feat: Implement Body Parsing and HTTP Response Enhancements #19
- feat: implement NestJS middleware pipeline #20
- feat: implement advanced HTTP features (multipart, static files, CORS, compression) #23
- refactor: migrate to domain-driven architecture separating HTTP and WebSocket concerns #26
- v2.0.0 HTTP Support for uWestJS #27
- add clarifying comments for two rejection callbacks in body-parser #149
- fix: avoid duplicate content-length on empty responses #148
- docs: add get assigned section to CONTRIBUTING.md #110
- docs: add JSDoc note about cookie serialization limitations #111
- Feat: Add proper documentation for both Websockets and HTTP capabilities #33
- chore: add .coderabbit.yaml to disable auto reviews #42
- feat: add comprehensive benchmark suite with CI/CD integration #45
- feat: export compression constants and auto-wrap ModuleRef #55
- Add Compression Benchmark Scenario #59
- Add streaming benchmark scenarios #66
- Feat: add e2e request body parsing test #98
- Test: Add req and res streaming e2e tests #106
- docs(body-parser): document flushBuffered exception behavior (#86) #101
- docs: update benchmark results in README.md #68
- Test: Add multipart file upload e2e test #108
- Include jest types for spec files #113
- shared frozen constant for empty JSON bodies #51
- Feat: add static-file serving e2e tests #115
- Add Missing response stream test #117
- feat: native HTTP response compression #121
- Feat: Add HTTP compression E2E test #123
- Feat: add CORS e2e test #127
- docs: add comprehensive keywords for discoverability #35 #46
- Create CONTRIBUTING.md #13
- Feat: add middleware execution e2e test #136
- Feat: add headers and cookies e2e tests #137
- Feat: add route matching e2e tests #141
- Feat: add error handling e2e tests #144
- Add HTTP method and connection handling e2e tests #166
- Feat: add NestJS DI e2e test #169

### Fixed
- Fixes critical WebSocket configuration gaps and async route handler errors. #32
- fix(websocket): throw on ExecutionContext.switchToRpc() #93
- test(multipart): remove redundant jest.useRealTimers in async handlers test #92
- Fix: misleading example in etagFn documentation #91
- fix(cors): reject preflight immediately if any requested header is disallowed #88
- fix(multipart): prevent options.headers from overriding request headers #75
- Upgrade NodeJS engine to 24<=25 and upgrade @types/node to 24 #44
- fix(http): resolve instance handling #128 and misleading jsDOC issue #145
- Fix: Skip benchmarks for Dependabot PRs #50
- test(request): verify empty-body json() cache on the same request (#80) #156
- Fix duplicate Content-Length header in CompressionHandler.compressBuffer() #60
- fix: critical streaming bugs for request and response streaming #65
- Remove unsafe abort handler fallback in _initBodyParser #70
- test(routing): compute content-length dynamically in middleware specs #109
- Fix: Refactor streaming mode test to use modern async/await pattern #102
- Fix #94 Return proper status code for large responses and #95 Support decompression #97
- Fix Content-Length piping RFC violation + optimize chunked mode syscalls #107
- docs: Use compress for HttpOptions in Compression.md #125
- Fix: merge standalone req and res stream e2e tests into one #142
- Fix: _write() chunked mode defers callback when backpressure is active #164
- fix: support HTTP middleware metadata instances #130
- fix: add benchmarks and test directory to exclude from the build #174
- chore: update eslint ignore patterns to match in subdirectories #170
- fix: suppress false-positive ERROR log on client-abort in handleException #165
- refactor(middleware): use metadataTarget consistently in class decorator branches #161
- fix: suppress response body for HEAD requests #154
- fix: support HEAD requests for GET routes #152
- fix(response): make send() a no-op when response already finished (#134) #135
- test(uws-platform): assert HEAD route registration on static-asset single-call tests #116

### Changed
- chore: Transfer repository under FOSSFORGE organization #41
- Make tests explicit in CI #159
- refactor: replace fragile ModuleRef detection #143
- chore: update CHANGELOG.md for v2 #177

## [1.0.1] - 2026-04-06

### Changed
- Updated uWebSockets.js dependency from v20.48.0 to v20.60.0
- Added Node.js 24 and 25 support
- Updated devDependencies to latest versions
- Include Jest types in tsconfig.json

## [1.0.0] - 2026-04-05

### Added
- Initial stable release of uWestJS
- High-performance WebSocket adapter using uWebSockets.js v20.48.0
- Full NestJS WebSocket decorator support
  - `@WebSocketGateway()` for gateway definition
  - `@SubscribeMessage()` for message handlers
  - `@MessageBody()` / `@Payload()` for message data extraction
  - `@ConnectedSocket()` for socket injection
- Complete middleware support
  - Guards for authentication and authorization
  - Pipes for data transformation and validation
  - Filters for exception handling
  - Dependency injection support via ModuleRef
- Room-based broadcasting with Socket.IO-compatible API
  - `client.join()` and `client.leave()` for room management
  - `client.to()` for room-targeted broadcasting
  - `client.broadcast` for broadcasting to all clients
  - `BroadcastOperator` with chaining support
- Lifecycle hooks support
  - `afterInit()` for gateway initialization
  - `handleConnection()` for client connections
  - `handleDisconnect()` for client disconnections
- Configuration options
  - Configurable port (default: 8099)
  - Maximum payload length configuration
  - Idle timeout configuration
  - Compression options (disabled, shared, dedicated)
  - WebSocket path configuration
  - CORS configuration with flexible origin validation
- Automatic backpressure handling and message queuing
- Manual gateway registration via `registerGateway()`
- Comprehensive test coverage with unit and integration tests
  - Separate test scripts for unit and integration tests
  - Full test suite with high coverage
- Complete documentation
  - Comprehensive README with quick start guide
  - Full API reference documentation
  - Migration guide from Socket.IO adapter
  - Versioning guide for maintainers
  - Performance tips and troubleshooting guide
- TypeScript support with full type definitions
- Support for NestJS 9.x, 10.x, and 11.x
- Node.js >= 20.0.0 requirement

### Technical Details
- Built on uWebSockets.js for maximum performance
- Socket.IO-compatible API for easy migration
- Efficient room management with automatic cleanup
- Native backpressure handling to prevent memory issues
- Metadata scanning for decorator-based routing
- Message router with handler execution pipeline
- Exception handling with WsException class
- Broadcast operator with room targeting and client exclusion

[Unreleased]: https://github.com/FOSSFORGE/uWestJS/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/FOSSFORGE/uWestJS/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/FOSSFORGE/uWestJS/releases/tag/v1.0.0
