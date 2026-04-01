import type {
  AnalysisReport,
  JudgedPlatformOffer,
  MovieRecord,
  MovieVersion,
  PlatformOffer,
  VerdictLabel,
  VersionTag,
} from "../../types/movie";

const priorityByTag: Record<VersionTag, number> = {
  "director-cut": 5,
  festival: 4,
  international: 3,
  extended: 2,
  restored: 2,
  mainland: 1,
  unknown: 0,
};

const NORMAL_TOLERANCE_SECONDS = 90;
const SHORTER_TOLERANCE_SECONDS = 180;
const LONGER_UNCUT_TOLERANCE_SECONDS = 180;
const LONGER_POSSIBLY_UNCUT_TOLERANCE_SECONDS = 300;
const POSSIBLE_CUT_SECONDS = 600;

function pickPreferredVersion(versions: MovieVersion[]): MovieVersion {
  return [...versions].sort((left, right) => {
    const priorityDiff = priorityByTag[right.tag] - priorityByTag[left.tag];

    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return right.durationSeconds - left.durationSeconds;
  })[0];
}

function findClosestVersion(
  versions: MovieVersion[],
  durationSeconds: number,
): MovieVersion | undefined {
  return [...versions].sort((left, right) => {
    const leftDelta = Math.abs(left.durationSeconds - durationSeconds);
    const rightDelta = Math.abs(right.durationSeconds - durationSeconds);
    return leftDelta - rightDelta;
  })[0];
}

function buildVerdict(
  offer: PlatformOffer,
  preferredVersion: MovieVersion,
  versions: MovieVersion[],
): JudgedPlatformOffer {
  if (!offer.available || !offer.durationSeconds) {
    return {
      ...offer,
      verdict: "信息不足",
      reason: offer.notes ?? "暂时拿不到可信的正片时长，后续接入真实抓取后再判断。",
    };
  }

  const deltaSeconds = offer.durationSeconds - preferredVersion.durationSeconds;
  const closestVersion = findClosestVersion(versions, offer.durationSeconds);
  const closestDelta = closestVersion
    ? Math.abs(offer.durationSeconds - closestVersion.durationSeconds)
    : Number.POSITIVE_INFINITY;

  let verdict: VerdictLabel;
  let reason: string;

  if (Math.abs(deltaSeconds) <= NORMAL_TOLERANCE_SECONDS) {
    verdict = "大概率无删减";
    reason = `与当前参考版本《${preferredVersion.label}》差异 ${Math.abs(deltaSeconds)} 秒，处于正常误差范围。`;
  } else if (deltaSeconds > 0 && deltaSeconds <= LONGER_UNCUT_TOLERANCE_SECONDS) {
    verdict = "大概率无删减";
    reason = `比参考版本长 ${deltaSeconds} 秒，仍像是片头片尾、平台提示或黑场带来的常见差异。`;
  } else if (
    deltaSeconds > LONGER_UNCUT_TOLERANCE_SECONDS &&
    deltaSeconds <= LONGER_POSSIBLY_UNCUT_TOLERANCE_SECONDS
  ) {
    verdict = "可能无删减";
    reason = `比参考版本长 ${deltaSeconds} 秒，可能包含额外片头片尾或平台附加内容，但暂时不像删减。`;
  } else if (
    deltaSeconds < 0 &&
    Math.abs(deltaSeconds) <= SHORTER_TOLERANCE_SECONDS
  ) {
    verdict = "可能无删减";
    reason = `比参考版本短 ${Math.abs(deltaSeconds)} 秒，可能只是分钟取整、片头片尾或平台展示差异。`;
  } else if (
    closestVersion &&
    closestVersion.id !== preferredVersion.id &&
    closestDelta <= NORMAL_TOLERANCE_SECONDS
  ) {
    verdict = "版本不一致";
    reason = `它与《${closestVersion.label}》更接近，像是另一个合法发行版本而不是单纯删减。`;
  } else if (deltaSeconds > LONGER_POSSIBLY_UNCUT_TOLERANCE_SECONDS) {
    verdict = "版本不一致";
    reason = `平台时长比当前参考版本更长 ${deltaSeconds} 秒，更像是不同版本而不是删减。`;
  } else if (Math.abs(deltaSeconds) <= POSSIBLE_CUT_SECONDS) {
    verdict = "可能删减";
    reason = `比参考版本短 ${Math.abs(deltaSeconds)} 秒，已经超出常见误差范围，需要谨慎看待。`;
  } else {
    verdict = "疑似删减";
    reason = `比参考版本短 ${Math.abs(deltaSeconds)} 秒，疑似存在明显删减。`;
  }

  return {
    ...offer,
    deltaSeconds,
    matchedVersionId: closestVersion?.id,
    verdict,
    reason,
  };
}

export function analyzeMovie(movie: MovieRecord): AnalysisReport {
  const preferredVersion = pickPreferredVersion(movie.versions);
  const alternateVersions = movie.versions.filter(
    (version) => version.id !== preferredVersion.id,
  );
  const platforms = movie.platforms.map((offer) =>
    buildVerdict(offer, preferredVersion, movie.versions),
  );

  const highPriorityVersions = movie.versions.filter(
    (version) => priorityByTag[version.tag] >= 3,
  );

  return {
    movie,
    preferredVersion,
    alternateVersions,
    platforms,
    generatedAt: new Date().toISOString(),
    caution:
      highPriorityVersions.length > 1
        ? "检测到多个高优先级版本，当前默认按导演剪辑版 / 电影节版 / 国际版优先，同优先级再选更长版本。"
        : movie.platforms.length === 0
          ? "这部电影当前没有识别到国内播放源，后续可以考虑补站外搜索作为兜底。"
          : undefined,
    status: "mock",
  };
}
