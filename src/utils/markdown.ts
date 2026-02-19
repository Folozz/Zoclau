/**
 * Simple markdown-to-HTML renderer for chat messages.
 * Handles basic formatting: bold, italic, code, links, lists, headings, and code blocks.
 */

/** Escape HTML special characters */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Convert a simple markdown string to HTML */
export function markdownToHtml(markdown: string): string {
    if (!markdown) return '';

    let html = '';
    const lines = markdown.split('\n');
    let inCodeBlock = false;
    let codeLanguage = '';
    let codeContent = '';
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Code blocks (```)
        if (line.trimStart().startsWith('```')) {
            if (inCodeBlock) {
                // End code block
                html += `<pre class="zoclau-code-block"><code class="language-${escapeHtml(codeLanguage)}">${escapeHtml(codeContent.trimEnd())}</code></pre>\n`;
                inCodeBlock = false;
                codeContent = '';
                codeLanguage = '';
            } else {
                // Start code block
                if (inList) {
                    html += '</ul>\n';
                    inList = false;
                }
                inCodeBlock = true;
                codeLanguage = line.trimStart().slice(3).trim() || 'text';
            }
            continue;
        }

        if (inCodeBlock) {
            codeContent += line + '\n';
            continue;
        }

        // Empty lines
        if (line.trim() === '') {
            if (inList) {
                html += '</ul>\n';
                inList = false;
            }
            continue;
        }

        // Headings
        const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
        if (headingMatch) {
            if (inList) {
                html += '</ul>\n';
                inList = false;
            }
            const level = headingMatch[1].length;
            const text = formatInline(headingMatch[2]);
            html += `<h${level} class="zoclau-heading">${text}</h${level}>\n`;
            continue;
        }

        // Unordered list items
        const listMatch = line.match(/^(\s*)[-*+]\s+(.+)/);
        if (listMatch) {
            if (!inList) {
                html += '<ul class="zoclau-list">\n';
                inList = true;
            }
            html += `<li>${formatInline(listMatch[2])}</li>\n`;
            continue;
        }

        // Ordered list items
        const olMatch = line.match(/^(\s*)\d+\.\s+(.+)/);
        if (olMatch) {
            if (!inList) {
                html += '<ul class="zoclau-list zoclau-list-ordered">\n';
                inList = true;
            }
            html += `<li>${formatInline(olMatch[2])}</li>\n`;
            continue;
        }

        // Regular paragraph
        if (inList) {
            html += '</ul>\n';
            inList = false;
        }
        html += `<p>${formatInline(line)}</p>\n`;
    }

    // Close any open elements
    if (inCodeBlock) {
        html += `<pre class="zoclau-code-block"><code>${escapeHtml(codeContent.trimEnd())}</code></pre>\n`;
    }
    if (inList) {
        html += '</ul>\n';
    }

    return html;
}

/** Format inline markdown elements */
function formatInline(text: string): string {
    let result = escapeHtml(text);

    // Inline code (must be before bold/italic to avoid conflicts)
    result = result.replace(/`([^`]+)`/g, '<code class="zoclau-inline-code">$1</code>');

    // Bold
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    result = result.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // Italic
    result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
    result = result.replace(/_(.+?)_/g, '<em>$1</em>');

    // Links
    result = result.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" class="zoclau-link" target="_blank">$1</a>'
    );

    return result;
}
