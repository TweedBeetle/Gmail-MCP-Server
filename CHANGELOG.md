# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **RFC 2822 compliant email threading**: Replies now include proper `In-Reply-To` and `References` headers
- New threading utilities module (`src/utils/threading.ts`) for handling email threading logic
- `getMessageHeaders()`: Fetches Message-ID, References, and Subject from emails
- `getThreadHeaders()`: Retrieves headers from the most recent message in a thread
- `buildReferencesChain()`: Constructs proper References header chain
- `ensureReplySubject()`: Automatically adds "Re:" prefix to reply subjects
- Comprehensive test suite for threading functionality (`src/tests/threading.test.ts`)
- Threading documentation in README with examples and migration guide

### Changed
- `send_email` and `draft_email` now properly implement email threading when `threadId` is provided
- When replying to a thread, the server automatically:
  - Fetches the Message-ID from the thread's most recent message
  - Constructs proper In-Reply-To and References headers
  - Inherits the subject line if not provided
  - Adds "Re:" prefix to subject (without duplication)
- Enhanced threading metadata in response messages (shows Thread ID, In-Reply-To, References)

### Removed
- **BREAKING CHANGE**: Removed `inReplyTo` parameter from `send_email` and `draft_email` schemas
  - This parameter was non-functional (accepted values but didn't implement threading)
  - Use `threadId` parameter instead for proper threading support
  - See README migration guide for upgrade instructions

### Fixed
- Email replies now properly thread in Gmail and all email clients (not just appearing as separate messages)
- Threading now complies with Gmail's 2019 policy requiring both threadId AND RFC 2822 headers

### Technical Details
- Threading implementation follows RFC 2822 email standards
- Graceful degradation: If threading headers can't be fetched, email still sends with threadId
- Supports multi-message conversation chains with proper References header building
- Works with both simple emails and emails with attachments

### Migration Guide

**Before (v1.1.x and earlier):**
```json
{
  "to": ["recipient@example.com"],
  "subject": "Re: Discussion",
  "body": "Reply content",
  "inReplyTo": "message-id-here"  // ❌ This didn't work
}
```

**After (v1.2.0+):**
```json
{
  "to": ["recipient@example.com"],
  "subject": "Re: Discussion",
  "body": "Reply content",
  "threadId": "18a83604c1db1f45"  // ✅ Use threadId instead
}
```

The `threadId` can be obtained from:
- The response when sending the initial email
- Search results when finding existing emails
- The read_email response

## [1.1.11] - Previous Release

See git history for changes in previous releases.
