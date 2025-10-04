#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class TmuxMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'tmux-mcp',
        version: '1.0.0',
      }
    );

    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'tmux_split_window',
            description: 'Split current tmux window into panes',
            inputSchema: {
              type: 'object',
              properties: {
                direction: {
                  type: 'string',
                  enum: ['horizontal', 'vertical'],
                  description: 'Direction to split the window',
                },
                command: {
                  type: 'string',
                  description: 'Command to run in the new pane (optional)',
                },
                directory: {
                  type: 'string',
                  description: 'Directory to start in (optional)',
                },
              },
              required: ['direction'],
            },
          },
          {
            name: 'tmux_new_window',
            description: 'Create a new tmux window',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Name for the new window (optional)',
                },
                command: {
                  type: 'string',
                  description: 'Command to run in the new window (optional)',
                },
                directory: {
                  type: 'string',
                  description: 'Directory to start in (optional)',
                },
              },
            },
          },
          {
            name: 'tmux_list_sessions',
            description: 'List all tmux sessions',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'tmux_list_windows',
            description: 'List windows in current session',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'tmux_send_keys',
            description: 'Send keys to a tmux pane',
            inputSchema: {
              type: 'object',
              properties: {
                keys: {
                  type: 'string',
                  description: 'Keys to send to the pane',
                },
                pane: {
                  type: 'string',
                  description: 'Target pane (optional, defaults to current)',
                },
                enter: {
                  type: 'boolean',
                  description: 'Whether to send Enter after the keys',
                  default: true,
                },
              },
              required: ['keys'],
            },
          },
          {
            name: 'tmux_open_nvim',
            description: 'Open nvim in a new pane with optional file',
            inputSchema: {
              type: 'object',
              properties: {
                file: {
                  type: 'string',
                  description: 'File path to open in nvim (optional)',
                },
                directory: {
                  type: 'string',
                  description: 'Directory to start nvim in (optional)',
                },
                split: {
                  type: 'string',
                  enum: ['horizontal', 'vertical'],
                  description: 'How to split for the new pane',
                  default: 'horizontal',
                },
              },
            },
          },
          {
            name: 'tmux_open_obsidian_note',
            description: 'Open a new Obsidian note in nvim in a new pane',
            inputSchema: {
              type: 'object',
              properties: {
                vault: {
                  type: 'string',
                  description: 'Vault name (optional, will list available vaults if not provided)',
                },
                note_name: {
                  type: 'string',
                  description: 'Name of the new note file (optional, will generate timestamp if not provided)',
                },
                split: {
                  type: 'string',
                  enum: ['horizontal', 'vertical'],
                  description: 'How to split for the new pane',
                  default: 'horizontal',
                },
              },
            },
          },
          {
            name: 'claude_mcp_add',
            description: 'Add a new MCP server to Claude Code',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Name for the MCP server',
                },
                command: {
                  type: 'string',
                  description: 'Command to run the MCP server',
                },
                args: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Arguments for the command (optional)',
                },
                env: {
                  type: 'object',
                  description: 'Environment variables (optional)',
                },
                transport: {
                  type: 'string',
                  enum: ['stdio', 'sse', 'http'],
                  description: 'Transport type (default: stdio)',
                  default: 'stdio',
                },
                url: {
                  type: 'string',
                  description: 'URL for remote servers (required for sse/http)',
                },
              },
              required: ['name'],
            },
          },
          {
            name: 'claude_mcp_list',
            description: 'List all configured MCP servers in Claude Code',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'tmux_split_window':
            return await this.splitWindow(args as any);
          case 'tmux_new_window':
            return await this.newWindow(args as any);
          case 'tmux_list_sessions':
            return await this.listSessions();
          case 'tmux_list_windows':
            return await this.listWindows();
          case 'tmux_send_keys':
            return await this.sendKeys(args as any);
          case 'tmux_open_nvim':
            return await this.openNvim(args as any);
          case 'tmux_open_obsidian_note':
            return await this.openObsidianNote(args as any);
          case 'claude_mcp_add':
            return await this.claudeMcpAdd(args as any);
          case 'claude_mcp_list':
            return await this.claudeMcpList();
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    });
  }

  private async splitWindow(args: {
    direction: 'horizontal' | 'vertical';
    command?: string;
    directory?: string;
  }) {
    const splitFlag = args.direction === 'horizontal' ? '-h' : '-v';
    let cmd = `tmux split-window ${splitFlag}`;
    
    if (args.directory) {
      cmd += ` -c "${args.directory}"`;
    }
    
    if (args.command) {
      cmd += ` "${args.command}"`;
    }

    const { stdout, stderr } = await execAsync(cmd);
    
    return {
      content: [
        {
          type: 'text',
          text: `Split window ${args.direction}ly${args.command ? ` and ran: ${args.command}` : ''}`,
        },
      ],
    };
  }

  private async newWindow(args: {
    name?: string;
    command?: string;
    directory?: string;
  }) {
    let cmd = 'tmux new-window';
    
    if (args.name) {
      cmd += ` -n "${args.name}"`;
    }
    
    if (args.directory) {
      cmd += ` -c "${args.directory}"`;
    }
    
    if (args.command) {
      cmd += ` "${args.command}"`;
    }

    const { stdout, stderr } = await execAsync(cmd);
    
    return {
      content: [
        {
          type: 'text',
          text: `Created new window${args.name ? ` '${args.name}'` : ''}`,
        },
      ],
    };
  }

  private async listSessions() {
    const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}: #{session_windows} windows"');
    
    return {
      content: [
        {
          type: 'text',
          text: `Tmux sessions:\n${stdout}`,
        },
      ],
    };
  }

  private async listWindows() {
    const { stdout } = await execAsync('tmux list-windows -F "#{window_index}: #{window_name} (#{window_panes} panes)"');
    
    return {
      content: [
        {
          type: 'text',
          text: `Current session windows:\n${stdout}`,
        },
      ],
    };
  }

  private async sendKeys(args: {
    keys: string;
    pane?: string;
    enter?: boolean;
  }) {
    let cmd = 'tmux send-keys';
    
    if (args.pane) {
      cmd += ` -t "${args.pane}"`;
    }
    
    cmd += ` "${args.keys}"`;
    
    if (args.enter !== false) {
      cmd += ' Enter';
    }

    const { stdout, stderr } = await execAsync(cmd);
    
    return {
      content: [
        {
          type: 'text',
          text: `Sent keys: ${args.keys}${args.enter !== false ? ' (with Enter)' : ''}`,
        },
      ],
    };
  }

  private async openNvim(args: {
    file?: string;
    directory?: string;
    split?: 'horizontal' | 'vertical';
  }) {
    const splitFlag = args.split === 'vertical' ? '-v' : '-h';
    let cmd = `tmux split-window ${splitFlag}`;
    
    if (args.directory) {
      cmd += ` -c "${args.directory}"`;
    }
    
    const nvimCmd = args.file ? `nvim "${args.file}"` : 'nvim';
    cmd += ` "${nvimCmd}"`;

    const { stdout, stderr } = await execAsync(cmd);
    
    return {
      content: [
        {
          type: 'text',
          text: `Opened nvim${args.file ? ` with file: ${args.file}` : ''} in new pane`,
        },
      ],
    };
  }

  private async openObsidianNote(args: {
    vault?: string;
    note_name?: string;
    split?: 'horizontal' | 'vertical';
  }) {
    const obsidianBase = '/Users/ldraney/Library/Mobile Documents/iCloud~md~obsidian/Documents';
    
    if (!args.vault) {
      const { stdout } = await execAsync(`ls "${obsidianBase}"`);
      return {
        content: [
          {
            type: 'text',
            text: `Available vaults:\n${stdout}`,
          },
        ],
      };
    }

    const vaultPath = `${obsidianBase}/${args.vault}`;
    const noteName = args.note_name || new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-') + '.md';
    const filePath = `${vaultPath}/${noteName}`;
    
    const splitFlag = args.split === 'vertical' ? '-v' : '-h';
    const cmd = `tmux split-window ${splitFlag} -c "${vaultPath}" "nvim '${filePath}'"`;

    await execAsync(cmd);
    
    return {
      content: [
        {
          type: 'text',
          text: `Opened new Obsidian note "${noteName}" in vault "${args.vault}"`,
        },
      ],
    };
  }

  private async claudeMcpAdd(args: {
    name: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    transport?: 'stdio' | 'sse' | 'http';
    url?: string;
  }) {
    let cmd = `claude mcp add`;
    
    if (args.transport && args.transport !== 'stdio') {
      cmd += ` --transport ${args.transport}`;
    }
    
    if (args.env) {
      for (const [key, value] of Object.entries(args.env)) {
        cmd += ` --env ${key}=${value}`;
      }
    }
    
    cmd += ` ${args.name}`;
    
    if (args.transport === 'sse' || args.transport === 'http') {
      if (!args.url) {
        throw new Error('URL is required for sse/http transport');
      }
      cmd += ` ${args.url}`;
    } else {
      if (!args.command) {
        throw new Error('Command is required for stdio transport');
      }
      cmd += ` ${args.command}`;
      if (args.args) {
        cmd += ` ${args.args.join(' ')}`;
      }
    }

    const { stdout, stderr } = await execAsync(cmd);
    
    return {
      content: [
        {
          type: 'text',
          text: `Added MCP server "${args.name}"\n${stdout}${stderr ? `\nErrors: ${stderr}` : ''}`,
        },
      ],
    };
  }

  private async claudeMcpList() {
    const { stdout } = await execAsync('claude mcp list');
    
    return {
      content: [
        {
          type: 'text',
          text: `Configured MCP servers:\n${stdout}`,
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new TmuxMCPServer();
server.run().catch(console.error);