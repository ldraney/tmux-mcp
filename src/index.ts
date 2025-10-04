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
      },
      {
        capabilities: {
          tools: {},
        },
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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new TmuxMCPServer();
server.run().catch(console.error);