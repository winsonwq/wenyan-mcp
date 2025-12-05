#!/usr/bin/env node

/**
 * 文颜 MCP Server
 * 支持将 Markdown 格式的文章和图片消息发布至微信公众号草稿箱
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getGzhContent } from "@wenyan-md/core/wrapper";
import { publishToDraft } from "@wenyan-md/core/publish";
import { themes, Theme } from "@wenyan-md/core/theme";
import {
    getAccessToken,
    uploadPermanentMaterial,
    publishImageMessageToDraft,
} from "./wechat-api.js";

/**
 * 创建 MCP 服务器，支持发布文章和图片消息到微信公众号
 */
const server = new Server(
    {
        name: "wenyan-mcp",
        version: "0.1.0",
    },
    {
        capabilities: {
            resources: {},
            tools: {},
            prompts: {},
            // logging: {},
        },
    }
);

/**
 * 列出可用的工具
 * - publish_article: 发布文章到微信公众号草稿箱
 * - list_themes: 列出可用的主题
 * - publish_image_message: 发布图片消息（图文消息）到微信公众号草稿箱
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "publish_article",
                description:
                    "Format a Markdown article using a selected theme and publish it to '微信公众号'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        content: {
                            type: "string",
                            description: "The original Markdown content to publish, preserving its frontmatter (if present).",
                        },
                        theme_id: {
                            type: "string",
                            description:
                                "ID of the theme to use (e.g., default, orangeheart, rainbow, lapis, pie, maize, purple, phycat).",
                        },
                    },
                    required: ["content"],
                },
            },
            {
                name: "list_themes",
                description:
                    "List the themes compatible with the 'publish_article' tool to publish an article to '微信公众号'.",
                inputSchema: {
                    type: "object",
                    properties: {}
                },
            },
            {
                name: "publish_image_message",
                description:
                    "发布图片消息（图文消息）到微信公众号草稿箱。图片消息由多张图片和一段文字描述组成，类似小红书笔记的形式。",
                inputSchema: {
                    type: "object",
                    properties: {
                        title: {
                            type: "string",
                            description: "图片消息的标题",
                        },
                        content: {
                            type: "string",
                            description: "文字描述内容",
                        },
                        images: {
                            type: "array",
                            description: "图片列表，支持本地路径或网络URL",
                            items: {
                                type: "string",
                            },
                        },
                    },
                    required: ["title", "content", "images"],
                },
            },
        ],
    };
});

/**
 * 处理工具调用请求
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "publish_article") {
        // server.sendLoggingMessage({
        //     level: "debug",
        //     data: JSON.stringify(request.params.arguments),
        // });
        const content = String(request.params.arguments?.content || "");
        const themeId = String(request.params.arguments?.theme_id || "");
        const gzhContent = await getGzhContent(content, themeId, "solarized-light", true, true);
        const title = gzhContent.title ?? "this is title";
        const cover = gzhContent.cover ?? "";
        const response = await publishToDraft(title, gzhContent.content, cover);

        return {
            content: [
                {
                    type: "text",
                    text: `Your article was successfully published to '公众号草稿箱'. The media ID is ${response.media_id}.`,
                },
            ],
        };
    } else if (request.params.name === "list_themes") {
        const themeResources = Object.entries(themes).map(([id, theme]: [string, Theme]) => ({
            type: "text",
            text: JSON.stringify({
                id: theme.id,
                name: theme.name,
                description: theme.description
            }),
        }));
        return {
            content: themeResources,
        };
    } else if (request.params.name === "publish_image_message") {
        const appId = process.env.WECHAT_APP_ID;
        const appSecret = process.env.WECHAT_APP_SECRET;

        if (!appId || !appSecret) {
            throw new Error("未设置 WECHAT_APP_ID 或 WECHAT_APP_SECRET 环境变量");
        }

        const title = String(request.params.arguments?.title || "");
        const content = String(request.params.arguments?.content || "");
        const images = request.params.arguments?.images as string[] || [];

        if (!title || !content || images.length === 0) {
            throw new Error("title、content 和 images 参数都是必需的，且 images 不能为空");
        }

        // 获取 access_token
        const accessToken = await getAccessToken(appId, appSecret);

        // 上传所有图片，获取 media_id
        const imageMediaIds: string[] = [];
        for (const imagePath of images) {
            const mediaId = await uploadPermanentMaterial(accessToken, imagePath);
            imageMediaIds.push(mediaId);
        }

        // 发布图片消息
        const mediaId = await publishImageMessageToDraft(
            accessToken,
            title,
            content,
            imageMediaIds
        );

        return {
            content: [
                {
                    type: "text",
                    text: `图片消息已成功发布到公众号草稿箱。Media ID: ${mediaId}`,
                },
            ],
        };
    }

    throw new Error("Unknown tool");
});


/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
