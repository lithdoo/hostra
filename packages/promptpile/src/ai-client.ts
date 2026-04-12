import fetch from 'node-fetch';
import type { Message } from './types';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

interface ChatCompletionStreamChunk {
  choices?: Array<{ delta?: { content?: string } }>;
  error?: { message?: string };
}

const trimTrailingSlash = (url: string) => url.replace(/\/$/, '');

const createPayload = (model: string, messages: Message[], stream: boolean) => ({
  model,
  stream,
  messages: messages.map(msg => ({
    role: msg.role,
    content: msg.content
  }))
});

const createHeaders = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json'
});

export const callAI = async (
  apiKey: string,
  apiBaseUrl: string,
  model: string,
  messages: Message[]
): Promise<string> => {
  const url = `${trimTrailingSlash(apiBaseUrl)}/chat/completions`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: createHeaders(apiKey),
      body: JSON.stringify(createPayload(model, messages, false))
    });

    const data = (await res.json()) as ChatCompletionResponse;

    if (!res.ok) {
      const detail = data.error?.message ?? res.statusText;
      console.error('Error calling AI API:', detail);
      throw new Error(`AI API error (${res.status}): ${detail}`);
    }

    return data.choices?.[0]?.message?.content ?? '';
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AI API error')) {
      throw error;
    }
    console.error('Error calling AI API:', error);
    console.error('Please check your network connection and API key');
    throw new Error('Failed to call AI API. Please check your network connection and API key.');
  }
};

export const callAIStream = async (
  apiKey: string,
  apiBaseUrl: string,
  model: string,
  messages: Message[],
  onChunk: (chunk: string) => void
): Promise<string> => {
  const url = `${trimTrailingSlash(apiBaseUrl)}/chat/completions`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: createHeaders(apiKey),
      body: JSON.stringify(createPayload(model, messages, true))
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as ChatCompletionStreamChunk;
      const detail = data.error?.message ?? res.statusText;
      console.error('Error calling AI API:', detail);
      throw new Error(`AI API error (${res.status}): ${detail}`);
    }

    if (!res.body) {
      throw new Error('AI API did not return a stream body.');
    }

    let fullText = '';
    let buffer = '';

    for await (const chunk of res.body) {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) {
          continue;
        }

        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') {
          continue;
        }

        try {
          const data = JSON.parse(payload) as ChatCompletionStreamChunk;
          const piece = data.choices?.[0]?.delta?.content ?? '';
          if (piece) {
            fullText += piece;
            onChunk(piece);
          }
        } catch {
          // Ignore non-JSON lines to keep streaming resilient across providers.
        }
      }
    }

    if (buffer.trim().startsWith('data:')) {
      const payload = buffer.trim().slice(5).trim();
      if (payload && payload !== '[DONE]') {
        try {
          const data = JSON.parse(payload) as ChatCompletionStreamChunk;
          const piece = data.choices?.[0]?.delta?.content ?? '';
          if (piece) {
            fullText += piece;
            onChunk(piece);
          }
        } catch {
          // Ignore trailing malformed payload.
        }
      }
    }

    return fullText;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AI API error')) {
      throw error;
    }
    console.error('Error calling AI API:', error);
    console.error('Please check your network connection and API key');
    throw new Error('Failed to call AI API. Please check your network connection and API key.');
  }
};
