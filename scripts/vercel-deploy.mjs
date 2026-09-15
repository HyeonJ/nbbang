/**
 * Vercel 프로덕션 배포 — REST API(`POST /v13/deployments`)로 만들고 끝날 때까지 폴링한다.
 *
 * 왜 CLI가 아니라 REST인가: 등록된 VERCEL_TOKEN은 **프로젝트 스코프** 토큰이다.
 * `GET /v9/projects/{id}`는 200이지만 `GET /v2/user`는 404, `GET /v2/teams`는 403이다.
 * Vercel CLI는 모든 명령이 먼저 사용자를 조회하므로 whoami·project ls·deploy가 전부
 * "User not found"로 죽는다. REST 배포 API는 그 조회를 하지 않아 이 토큰으로 동작한다.
 * → 이 스크립트를 `vercel deploy`로 "단순화"하지 말 것. 토큰이 계정 토큰으로 교체되기
 *   전까지는 CLI가 구조적으로 불가능하다.
 *
 * 왜 gitSource인가: sha를 명시하면 CI가 검증한 **바로 그 커밋**이 배포된다(배포 훅은
 * "발동 시점의 브랜치 HEAD"를 빌드해 그 보장이 없다). 빌드는 Vercel에서 돌므로
 * 지금까지 성공해 온 Git 배포와 빌드 환경이 같고, 프로덕션 자격증명이 러너에 내려오지 않는다.
 *
 * 왜 폴링하는가: POST는 배포를 큐에 넣고 즉시 200을 준다. 폴링하지 않으면 빌드가 깨져도
 * 잡이 초록이 되어, 이 잡이 유일한 배포 경로라는 설계 자체가 무의미해진다.
 *
 * 왜 별칭까지 폴링하는가: READY는 "빌드가 끝났다"는 뜻일 뿐, 프로덕션 별칭이 이 배포로
 * 옮겨졌다는 뜻이 아니다. READY 직후 aliasAssigned는 잠깐 false다. 그 순간을 보고
 * 성공으로 끝내면 **트래픽이 이전 배포에 남아 있는데도 잡이 초록이 된다** — 이 잡이
 * 막으려는 바로 그 상태다. 그래서 별칭이 정해질 때까지(aliasAssigned 또는 aliasError)
 * 폴링을 끝내지 않고, 끝까지 안 붙으면 실패로 끝낸다. 대기는 아래 10분 데드라인이 막는다.
 *
 * 필요 env: VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_REPO_ID, VERCEL_GIT_REF, GITHUB_SHA
 * 토큰은 절대 출력하지 않는다. 응답 본문도 통째로 찍지 않고 필요한 필드만 찍는다.
 */
import fs from 'node:fs';

const API = 'https://api.vercel.com';
const POLL_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 10 * 60 * 1_000;
const TERMINAL = new Set(['READY', 'ERROR', 'CANCELED', 'DELETED']);

/** 요약은 로그와 잡 서머리 양쪽에 남긴다 — 사람이 배포 URL을 찾을 수 있어야 한다. */
function report(line) {
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
    }
}

/** 실패 응답에서 원인만 뽑는다. 본문 전체를 찍지 않는다. */
async function explain(response) {
    try {
        const body = await response.json();
        const error = body?.error ?? {};
        return `${error.code ?? '?'}: ${error.message ?? '(메시지 없음)'}`;
    } catch {
        return '(본문 파싱 실패)';
    }
}

/**
 * 실패는 throw로 알린다 — fetch가 열려 있는 동안 process.exit()를 부르면
 * Windows 로컬 실행에서 libuv가 assert로 죽어 원인 메시지가 묻힌다.
 */
class DeployError extends Error {}

function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new DeployError(`${name}이 없습니다.`);
    }
    return value;
}

async function main() {
    const token = requireEnv('VERCEL_TOKEN');
    const projectId = requireEnv('VERCEL_PROJECT_ID');
    const repoId = Number(requireEnv('VERCEL_REPO_ID'));
    const ref = requireEnv('VERCEL_GIT_REF');
    const sha = requireEnv('GITHUB_SHA');

    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const created = await fetch(`${API}/v13/deployments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            name: 'nbbang',
            project: projectId,
            target: 'production',
            // ref는 Vercel이 브랜치 메타데이터로 쓰고, 실제로 빌드되는 것은 sha다.
            gitSource: { type: 'github', repoId, ref, sha },
        }),
    });

    if (!created.ok) {
        throw new DeployError(`배포 생성 실패 — HTTP ${created.status} ${await explain(created)}`);
    }

    const { id, url } = await created.json();
    report(`배포 생성됨: ${id}`);
    report(`배포 URL: https://${url}`);
    report(`커밋: ${sha} (ref ${ref})`);

    const deadline = Date.now() + TIMEOUT_MS;
    let state = null;
    let deployment = null;

    /** 별칭이 정해졌는가 — 붙었거나(assigned) 붙이다 실패했거나(error). 둘 다 아니면 아직 진행 중이다. */
    const aliasSettled = () => Boolean(deployment?.aliasAssigned || deployment?.aliasError);
    /** 판정 가능한 최종 상태인가. READY는 별칭까지 정해져야 최종이다. */
    const isSettled = () => TERMINAL.has(state) && (state !== 'READY' || aliasSettled());

    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        const polled = await fetch(`${API}/v13/deployments/${id}`, { headers });
        if (!polled.ok) {
            // 폴링이 막히면 성공으로 넘기지 않는다 — 판정 불가는 실패다.
            throw new DeployError(`상태 조회 실패 — HTTP ${polled.status} ${await explain(polled)}`);
        }

        deployment = await polled.json();
        if (deployment.readyState !== state) {
            state = deployment.readyState;
            console.log(`  상태: ${state}`);
        }
        // READY만으로는 빠져나가지 않는다 — 별칭이 정해질 때까지 계속 폴링한다.
        if (isSettled()) {
            break;
        }
    }

    if (!TERMINAL.has(state)) {
        throw new DeployError(`10분 안에 끝나지 않았습니다 — 마지막 상태 ${state ?? '(조회 전)'}`);
    }

    report(`최종 상태: ${state}`);

    if (state !== 'READY') {
        throw new DeployError('배포가 실패했습니다 — Vercel 대시보드의 빌드 로그를 보세요.');
    }

    if (deployment.aliasError) {
        const { code, message } = deployment.aliasError;
        throw new DeployError(`별칭 할당 실패: ${code ?? '?'} ${message ?? ''}`);
    }
    // 데드라인까지 폴링해도 별칭이 안 붙은 경우다. 경고로 넘기면 "초록인데 프로덕션은
    // 이전 배포" 상태가 성공으로 보고된다 — 이 잡이 존재하는 이유가 사라진다.
    if (!deployment.aliasAssigned) {
        throw new DeployError('READY지만 프로덕션 별칭이 이 배포를 가리키지 않는다 — 트래픽은 이전 배포에 남아 있다.');
    }
    const aliases = (deployment.alias ?? []).map((a) => `https://${a}`).join(' ');
    report(`프로덕션 별칭: ${aliases || '(목록 없음)'}`);
}

try {
    await main();
} catch (error) {
    if (error instanceof DeployError) {
        report(error.message);
    } else {
        report(`예상치 못한 오류: ${error.message}`);
    }
    process.exitCode = 1;
}
