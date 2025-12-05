/**
 * 微信公众号 API 辅助函数
 */

import { FormData, Blob } from "formdata-node";
import { fileFromPath } from "formdata-node/file-from-path";
import { basename } from "path";

interface AccessTokenResponse {
    access_token: string;
    expires_in: number;
}

interface MediaUploadResponse {
    url: string;
}

interface DraftAddResponse {
    media_id: string;
}

/**
 * 获取 access_token
 */
export async function getAccessToken(
    appId: string,
    appSecret: string
): Promise<string> {
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
    const response = await fetch(url);
    const data = (await response.json()) as AccessTokenResponse & { errcode?: number; errmsg?: string };

    if (data.errcode) {
        throw new Error(`获取 access_token 失败: ${data.errmsg || data.errcode}`);
    }

    if (!data.access_token) {
        throw new Error("获取 access_token 失败: 响应中未包含 access_token");
    }

    return data.access_token;
}

/**
 * 上传图片到微信服务器，获取图片 URL
 * 注意：这个接口返回的是图片 URL，不是 media_id
 * 对于图片消息，需要使用永久素材接口上传图片获取 media_id
 * 此函数目前未使用，保留以备将来需要
 */
export async function uploadImage(
    accessToken: string,
    imagePath: string
): Promise<string> {
    let filename = "image.jpg";
    let file: any;
    
    if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
        const response = await fetch(imagePath);
        if (!response.ok || !response.body) {
            throw new Error(`Failed to download image from URL: ${imagePath}`);
        }
        const urlPath = new URL(imagePath).pathname;
        filename = urlPath.split("/").pop() || "image.jpg";
        const arrayBuffer = await response.arrayBuffer();
        file = new Blob([arrayBuffer]);
    } else {
        filename = basename(imagePath);
        file = await fileFromPath(imagePath);
    }

    const form = new FormData();
    form.append("media", file, filename);

    const url = `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${accessToken}`;
    const response = await fetch(url, {
        method: "POST",
        body: form as any,
    });

    const data = (await response.json()) as MediaUploadResponse & { errcode?: number; errmsg?: string };

    if (data.errcode) {
        throw new Error(`上传图片失败: ${data.errmsg || data.errcode}`);
    }

    if (!data.url) {
        throw new Error("上传图片失败: 响应中未包含图片 URL");
    }

    return data.url;
}

/**
 * 上传永久素材，获取 media_id
 * 图片消息需要使用永久素材的 media_id
 */
export async function uploadPermanentMaterial(
    accessToken: string,
    filePath: string,
    type: "image" | "video" = "image",
    description?: { title?: string; introduction?: string }
): Promise<string> {
    // 根据类型确定默认文件名
    const defaultFilename = type === "video" ? "video.mp4" : "image.jpg";
    let filename = defaultFilename;
    let file: any;
    
    if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
        // 网络 URL：先下载，然后创建 Blob（与 @wenyan-md/core 保持一致）
        const response = await fetch(filePath);
        if (!response.ok || !response.body) {
            throw new Error(`Failed to download file from URL: ${filePath}`);
        }
        const urlPath = new URL(filePath).pathname;
        filename = urlPath.split("/").pop() || defaultFilename;
        const arrayBuffer = await response.arrayBuffer();
        file = new Blob([arrayBuffer]);
    } else {
        // 本地文件：使用 fileFromPath，与 @wenyan-md/core 保持一致
        filename = basename(filePath);
        file = await fileFromPath(filePath);
    }

    // 上传永久素材
    // 与 @wenyan-md/core 的实现保持一致
    // @wenyan-md/core 使用 form.append("media", e, r)，其中 e 是文件对象，r 是文件名
    const form = new FormData();
    if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
        // 网络 URL：Blob 需要传入 filename
        form.append("media", file, filename);
    } else {
        // 本地文件：File 对象已经有 name，但根据 @wenyan-md/core 的实现，仍然传入 filename
        form.append("media", file, filename);
    }
    
    // 视频类型需要额外的 description 参数
    if (type === "video" && description) {
        form.append("description", JSON.stringify(description));
    }

    const url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${accessToken}&type=${type}`;
    
    // 使用标准的 fetch，与 @wenyan-md/core 保持一致
    const response = await fetch(url, {
        method: "POST",
        body: form as any,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`上传永久素材失败: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as { media_id: string; url?: string } & { errcode?: number; errmsg?: string };

    if (data.errcode) {
        throw new Error(`上传永久素材失败: ${data.errmsg || data.errcode}`);
    }

    if (!data.media_id) {
        throw new Error("上传永久素材失败: 响应中未包含 media_id");
    }

    return data.media_id;
}

/**
 * 发布图片消息到草稿箱
 */
export async function publishImageMessageToDraft(
    accessToken: string,
    title: string,
    content: string,
    imageMediaIds: string[]
): Promise<string> {
    const url = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${accessToken}`;

    const requestBody = {
        articles: [
            {
                article_type: "newspic",
                title,
                content,
                image_info: {
                    image_list: imageMediaIds.map((mediaId) => ({
                        image_media_id: mediaId,
                    })),
                },
                need_open_comment: 0,
                only_fans_can_comment: 0,
            },
        ],
    };

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
    });

    const data = (await response.json()) as DraftAddResponse & { errcode?: number; errmsg?: string };

    if (data.errcode) {
        throw new Error(`发布图片消息失败: ${data.errmsg || data.errcode}`);
    }

    if (!data.media_id) {
        throw new Error("发布图片消息失败: 响应中未包含 media_id");
    }

    return data.media_id;
}

