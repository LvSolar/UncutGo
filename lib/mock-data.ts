import type { MovieRecord } from "../types/movie";

export const mockMovies: MovieRecord[] = [
  {
    id: "in-bruges-2008",
    inputHints: ["杀手没有假期", "in bruges", "布鲁日", "2008"],
    title: "杀手没有假期",
    originalTitle: "In Bruges",
    year: 2008,
    director: "马丁·麦克唐纳",
    doubanRating: 8.1,
    doubanUrl: "https://movie.douban.com/subject/1857099/",
    summary: "两个杀手在布鲁日停留避风头，却被卷回一场失控的善恶抉择。",
    versions: [
      {
        id: "festival",
        label: "圣丹斯 / 电影节版本",
        durationSeconds: 6430,
        source: "豆瓣整理",
        tag: "festival",
        notes: "107 分 10 秒，作为高优先级参考版本。",
      },
      {
        id: "international",
        label: "国际发行版",
        durationSeconds: 6415,
        source: "公开资料交叉整理",
        tag: "international",
      },
      {
        id: "mainland",
        label: "中国大陆常见版本",
        durationSeconds: 6330,
        source: "样例数据",
        tag: "mainland",
      },
    ],
    platforms: [
      {
        id: "tencent",
        platform: "腾讯视频",
        available: true,
        url: "https://v.qq.com/",
        durationSeconds: 6412,
        durationLabel: "1:46:52",
        notes: "样例数据：接近国际版。",
      },
      {
        id: "bilibili",
        platform: "哔哩哔哩",
        available: true,
        url: "https://www.bilibili.com/",
        durationSeconds: 6322,
        durationLabel: "1:45:22",
        notes: "样例数据：明显更短，用来验证删减判定。",
      },
    ],
  },
  {
    id: "blade-runner-final-cut",
    inputHints: ["银翼杀手", "blade runner", "final cut", "1982"],
    title: "银翼杀手",
    originalTitle: "Blade Runner",
    year: 1982,
    director: "雷德利·斯科特",
    doubanRating: 8.6,
    doubanUrl: "https://movie.douban.com/subject/1291839/",
    summary: "复制人与追捕者的宿命对决，也是版本差异极多的一部经典作品。",
    versions: [
      {
        id: "directors-cut",
        label: "导演剪辑版",
        durationSeconds: 6970,
        source: "样例数据",
        tag: "director-cut",
      },
      {
        id: "final-cut",
        label: "最终剪辑版",
        durationSeconds: 7010,
        source: "样例数据",
        tag: "director-cut",
        notes: "同优先级下更长，应成为默认参考版本。",
      },
      {
        id: "mainland",
        label: "中国大陆常见版本",
        durationSeconds: 6810,
        source: "样例数据",
        tag: "mainland",
      },
    ],
    platforms: [
      {
        id: "tencent",
        platform: "腾讯视频",
        available: false,
        url: "https://v.qq.com/",
        notes: "样例数据：暂时没有拿到可信的片长。",
      },
      {
        id: "bilibili",
        platform: "哔哩哔哩",
        available: true,
        url: "https://www.bilibili.com/",
        durationSeconds: 6808,
        durationLabel: "1:53:28",
        notes: "样例数据：更接近大陆常见版本。",
      },
    ],
  },
];

export function findMoviesByQuery(query: string): MovieRecord[] {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return [];
  }

  return mockMovies.filter((movie) =>
    movie.inputHints.some((hint) => hint.toLowerCase().includes(normalized)) ||
    `${movie.title} ${movie.originalTitle} ${movie.year}`
      .toLowerCase()
      .includes(normalized),
  );
}

export function findMovieById(id: string): MovieRecord | undefined {
  return mockMovies.find((movie) => movie.id === id);
}
