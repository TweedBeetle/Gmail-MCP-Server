/**
 * Threading Integration Tests
 *
 * These tests verify proper RFC 2822 email threading implementation.
 * Requires two Gmail accounts configured in google-credentials directory.
 *
 * Run with: npm test
 */

import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import { getThreadHeaders, buildReferencesChain, ensureReplySubject } from '../utils/threading.js';
import { createEmailMessage } from '../utl.js';

// Configuration for two test accounts
const PERSONAL_CREDS = path.join(process.env.HOME!, 'google-credentials', 'personal');
const WORK_CREDS = path.join(process.env.HOME!, 'google-credentials', 'work');

interface TestAccount {
    name: string;
    email: string;
    gmail: gmail_v1.Gmail;
}

let personalAccount: TestAccount;
let workAccount: TestAccount;

/**
 * Initialize Gmail API client for an account
 */
async function initializeAccount(credsDir: string, name: string): Promise<TestAccount> {
    const oauthPath = path.join(credsDir, 'gcp-oauth.keys.json');
    const credentialsPath = path.join(credsDir, 'credentials.json');

    const keysContent = JSON.parse(fs.readFileSync(oauthPath, 'utf8'));
    const keys = keysContent.installed || keysContent.web;

    const oauth2Client = new OAuth2Client(
        keys.client_id,
        keys.client_secret,
        "http://localhost:3000/oauth2callback"
    );

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    oauth2Client.setCredentials(credentials);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get email address
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress!;

    return { name, email, gmail };
}

/**
 * Send a test email and return message details
 */
async function sendTestEmail(
    from: TestAccount,
    to: string,
    subject: string,
    body: string,
    threadId?: string
): Promise<{ id: string, threadId: string }> {
    const message = createEmailMessage({
        to: [to],
        subject,
        body,
        threadId
    });

    const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const requestBody: any = {
        raw: encodedMessage
    };

    if (threadId) {
        requestBody.threadId = threadId;
    }

    const response = await from.gmail.users.messages.send({
        userId: 'me',
        requestBody
    });

    return {
        id: response.data.id!,
        threadId: response.data.threadId!
    };
}

/**
 * Get message headers for verification
 */
async function getMessageHeaders(
    account: TestAccount,
    messageId: string
): Promise<Map<string, string>> {
    const response = await account.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
    });

    const headers = response.data.payload?.headers || [];
    const headerMap = new Map<string, string>();

    for (const header of headers) {
        if (header.name && header.value) {
            headerMap.set(header.name, header.value);
        }
    }

    return headerMap;
}

/**
 * Delete a test message
 */
async function deleteMessage(account: TestAccount, messageId: string) {
    try {
        await account.gmail.users.messages.delete({
            userId: 'me',
            id: messageId
        });
    } catch (error) {
        console.warn(`Failed to delete message ${messageId}:`, error);
    }
}

// Test setup and teardown
beforeAll(async () => {
    personalAccount = await initializeAccount(PERSONAL_CREDS, 'personal');
    workAccount = await initializeAccount(WORK_CREDS, 'work');

    console.log(`\nInitialized test accounts:`);
    console.log(`  Personal: ${personalAccount.email}`);
    console.log(`  Work: ${workAccount.email}\n`);
});

describe('Email Threading', () => {
    const testMessages: string[] = [];

    afterEach(async () => {
        // Clean up test messages
        for (const messageId of testMessages) {
            await deleteMessage(personalAccount, messageId);
        }
        testMessages.length = 0;

        // Wait a bit to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    });

    test('Basic Reply Threading', async () => {
        // Send initial email from personal to work
        const initial = await sendTestEmail(
            personalAccount,
            workAccount.email,
            'Threading Test 1',
            'This is the initial message'
        );
        testMessages.push(initial.id);

        console.log(`Initial message sent: ${initial.id}`);
        console.log(`Thread ID: ${initial.threadId}`);

        // Wait for message to be delivered
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Get threading headers from initial message
        const threadHeaders = await getThreadHeaders(personalAccount.gmail, initial.threadId);
        expect(threadHeaders).not.toBeNull();
        expect(threadHeaders!.messageId).toBeDefined();
        expect(threadHeaders!.subject).toBe('Threading Test 1');

        console.log(`Message-ID: ${threadHeaders!.messageId}`);

        // Send reply
        const reply = await sendTestEmail(
            personalAccount,
            workAccount.email,
            'Re: Threading Test 1',
            'This is a reply',
            initial.threadId
        );
        testMessages.push(reply.id);

        console.log(`Reply sent: ${reply.id}`);

        // Wait for reply to be delivered
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Verify reply has proper threading headers
        const replyHeaders = await getMessageHeaders(personalAccount, reply.id);

        expect(replyHeaders.has('In-Reply-To')).toBe(true);
        expect(replyHeaders.has('References')).toBe(true);
        expect(replyHeaders.get('In-Reply-To')).toBe(threadHeaders!.messageId);
        expect(replyHeaders.get('References')).toBe(threadHeaders!.messageId);
        expect(replyHeaders.get('Subject')).toContain('Re:');

        console.log(`In-Reply-To: ${replyHeaders.get('In-Reply-To')}`);
        console.log(`References: ${replyHeaders.get('References')}`);

        // Verify they're in the same thread
        expect(reply.threadId).toBe(initial.threadId);

        console.log('✓ Basic threading test passed\n');
    }, 30000);

    test('Multi-Message Thread', async () => {
        // Send initial message
        const msg1 = await sendTestEmail(
            personalAccount,
            workAccount.email,
            'Threading Test 2',
            'Message 1'
        );
        testMessages.push(msg1.id);
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Send first reply
        const msg2 = await sendTestEmail(
            personalAccount,
            workAccount.email,
            'Re: Threading Test 2',
            'Message 2',
            msg1.threadId
        );
        testMessages.push(msg2.id);
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Send second reply
        const msg3 = await sendTestEmail(
            personalAccount,
            workAccount.email,
            'Re: Threading Test 2',
            'Message 3',
            msg1.threadId
        );
        testMessages.push(msg3.id);
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Get headers from all messages
        const headers1 = await getMessageHeaders(personalAccount, msg1.id);
        const headers2 = await getMessageHeaders(personalAccount, msg2.id);
        const headers3 = await getMessageHeaders(personalAccount, msg3.id);

        const messageId1 = headers1.get('Message-ID')!;
        const messageId2 = headers2.get('Message-ID')!;

        // Verify References chain builds correctly
        expect(headers2.get('In-Reply-To')).toBe(messageId1);
        expect(headers2.get('References')).toBe(messageId1);

        expect(headers3.get('In-Reply-To')).toBe(messageId2);
        expect(headers3.get('References')).toContain(messageId1);
        expect(headers3.get('References')).toContain(messageId2);

        console.log('✓ Multi-message thread test passed\n');
    }, 60000);

    test('Subject Line Handling', async () => {
        // Test various subject line scenarios
        const subjects = [
            { input: 'Original Subject', expected: 'Re: Original Subject' },
            { input: 'Re: Original Subject', expected: 'Re: Original Subject' },
            { input: 'RE: Original Subject', expected: 'RE: Original Subject' },
            { input: 'Fwd: Original Subject', expected: 'Fwd: Original Subject' }
        ];

        for (const { input, expected } of subjects) {
            const result = ensureReplySubject(input);
            expect(result).toBe(expected);
        }

        console.log('✓ Subject line handling test passed\n');
    });
});

describe('Threading Utilities', () => {
    test('buildReferencesChain', () => {
        const msgId1 = '<msg1@example.com>';
        const msgId2 = '<msg2@example.com>';
        const msgId3 = '<msg3@example.com>';

        // First reply (no existing references)
        expect(buildReferencesChain(msgId1)).toBe(msgId1);

        // Second reply (existing references)
        expect(buildReferencesChain(msgId2, msgId1)).toBe(`${msgId1} ${msgId2}`);

        // Third reply (chain of references)
        expect(buildReferencesChain(msgId3, `${msgId1} ${msgId2}`))
            .toBe(`${msgId1} ${msgId2} ${msgId3}`);

        console.log('✓ References chain building test passed\n');
    });

    test('ensureReplySubject', () => {
        expect(ensureReplySubject('Test')).toBe('Re: Test');
        expect(ensureReplySubject('Re: Test')).toBe('Re: Test');
        expect(ensureReplySubject('RE: Test')).toBe('RE: Test');
        expect(ensureReplySubject('re: Test')).toBe('re: Test');
        expect(ensureReplySubject('Fwd: Test')).toBe('Fwd: Test');
        expect(ensureReplySubject('FW: Test')).toBe('FW: Test');

        console.log('✓ Reply subject prefix test passed\n');
    });
});

// Manual verification instructions
console.log(`
================================================================================
MANUAL VERIFICATION INSTRUCTIONS
================================================================================

After running these tests, manually verify threading from recipient perspective:

1. Log into work account: ${workAccount?.email || '[not initialized]'}
2. Check inbox for test emails
3. Verify all messages appear in a single thread
4. Click "Show original" on a reply to inspect raw headers:
   - Should see "In-Reply-To: <message-id>"
   - Should see "References: <message-id>" with full chain
   - Subject should have "Re:" prefix

5. Test with external email client (Outlook, Apple Mail, etc.):
   - Threading should work correctly
   - Replies should group together
   - "In reply to" should show original message

================================================================================
`);
