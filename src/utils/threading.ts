import { gmail_v1 } from 'googleapis';

/**
 * Headers extracted from an email for threading purposes
 */
export interface MessageHeaders {
    messageId?: string;
    references?: string;
    subject: string;
}

/**
 * Fetches the Message-ID, References, and Subject headers from a Gmail message
 * These are required for proper RFC 2822 compliant email threading
 *
 * @param gmail - Gmail API client instance
 * @param messageId - Gmail message ID (not the Message-ID header)
 * @returns MessageHeaders object with the extracted headers
 */
export async function getMessageHeaders(
    gmail: gmail_v1.Gmail,
    messageId: string
): Promise<MessageHeaders> {
    const response = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'metadata',
        metadataHeaders: ['Message-ID', 'References', 'Subject']
    });

    const headers = response.data.payload?.headers || [];

    return {
        messageId: headers.find(h => h.name === 'Message-ID')?.value || undefined,
        references: headers.find(h => h.name === 'References')?.value || undefined,
        subject: headers.find(h => h.name === 'Subject')?.value || ''
    };
}

/**
 * Builds the References header chain according to RFC 2822
 * The References header contains space-separated Message-IDs from the conversation
 *
 * @param replyToMessageId - Message-ID of the email being replied to
 * @param existingReferences - Existing References header from the original email
 * @returns Properly formatted References header value
 */
export function buildReferencesChain(
    replyToMessageId: string,
    existingReferences?: string
): string {
    if (existingReferences) {
        // Append to existing chain
        return `${existingReferences} ${replyToMessageId}`;
    } else {
        // Start new chain
        return replyToMessageId;
    }
}

/**
 * Ensures the subject line has the "Re:" prefix for replies
 * Handles edge cases like existing "Re:", "RE:", or "Fwd:" prefixes
 *
 * @param subject - Original subject line
 * @returns Subject with proper "Re:" prefix
 */
export function ensureReplySubject(subject: string): string {
    // Don't add Re: if it already has Re: or RE: (case insensitive)
    if (subject.match(/^(Re|RE|re):\s/)) {
        return subject;
    }

    // Don't add Re: to forwarded messages
    if (subject.match(/^(Fwd|FW|Fw):\s/i)) {
        return subject;
    }

    return `Re: ${subject}`;
}

/**
 * Fetches threading information from the most recent message in a Gmail thread
 *
 * @param gmail - Gmail API client instance
 * @param threadId - Gmail thread ID
 * @returns MessageHeaders from the most recent message, or null if thread is empty
 */
export async function getThreadHeaders(
    gmail: gmail_v1.Gmail,
    threadId: string
): Promise<MessageHeaders | null> {
    try {
        // Get the thread to find the most recent message
        const thread = await gmail.users.threads.get({
            userId: 'me',
            id: threadId
        });

        const messages = thread.data.messages || [];
        if (messages.length === 0) {
            return null;
        }

        // Get the most recent message (last in array)
        const lastMessage = messages[messages.length - 1];

        // Fetch its headers
        return await getMessageHeaders(gmail, lastMessage.id!);
    } catch (error: any) {
        // Log error but return null to allow graceful degradation
        console.warn('Failed to retrieve thread headers:', error.message);
        return null;
    }
}
