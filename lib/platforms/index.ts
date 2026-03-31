import { fetchBilibiliDuration } from "./bilibili";
import { fetchIqiyiDuration } from "./iqiyi";
import { fetchTencentDuration } from "./tencent";
import { fetchYoukuDuration } from "./youku";

export async function fetchPlatformDuration(url: string): Promise<{
  durationSeconds?: number;
  durationLabel?: string;
  notes?: string;
}> {
  if (url.includes("v.qq.com")) {
    return fetchTencentDuration(url);
  }

  if (url.includes("bilibili.com")) {
    return fetchBilibiliDuration(url);
  }

  if (url.includes("iqiyi.com") || url.includes("iq.com")) {
    return fetchIqiyiDuration(url);
  }

  if (url.includes("youku.com")) {
    return fetchYoukuDuration(url);
  }

  return {};
}

export { fetchLibvioOffer } from "./libvio";
