// 정보 화면: 앱 소개, 오리지널 고지, 기기 안 처리 안내, 사용 수칙, 단축키, 오픈소스 고지.
import type { ReactNode } from 'react';
import { SHORTCUTS } from '../../app/shortcuts.ts';
import { useAppStore } from '../../app/store.ts';
import { platform } from '../../engine/platform.ts';
import { MODEL_SIZE_LABEL } from '../components/EngineCard.tsx';
import { Icon } from '../components/Icon.tsx';
import type { IconName } from '../components/Icon.tsx';
import { Screen, Split } from '../components/Layout.tsx';

function Entry({ no, title, children }: { no: string; title: string; children: ReactNode }) {
  return (
    <section className="about__entry">
      <p className="about__no t-label" aria-hidden="true">
        {no}
      </p>
      <div className="about__content">
        <h2 className="t-head">{title}</h2>
        {children}
      </div>
    </section>
  );
}

const WHERE: Record<typeof platform.kind, string> = {
  web: '웹 브라우저',
  native: '휴대폰 앱',
  artifact: '게시된 페이지',
};

const ENGINE_STATUS = {
  idle: '아직 불러오지 않음',
  loading: '불러오는 중',
  ready: '준비됨',
  error: '불러오지 못함',
} as const;

/** 함께 들어간 오픈소스. 이름 · 쓰임 · 라이선스 */
const CREDITS: { name: string; use: string; license: string }[] = [
  { name: 'Supertonic 3', use: '글을 목소리로 바꾸는 음성 합성 모델 (Supertone)', license: 'OpenRAIL-M' },
  { name: 'ONNX Runtime Web', use: '모델을 기기 안에서 돌리는 실행기', license: 'MIT' },
  { name: 'Signalsmith Stretch', use: '목소리 높낮이·체구 바꾸기', license: 'MIT' },
  { name: 'lamejs', use: 'MP3 로 저장하기', license: 'LGPL-3.0' },
  { name: 'React · Zustand', use: '화면과 상태 관리', license: 'MIT' },
  { name: 'IBM Plex Mono', use: '영문·숫자 글꼴', license: 'SIL OFL 1.1' },
];

const TWO_KINDS: { icon: IconName; name: string; kind: string; body: string }[] = [
  {
    icon: 'studio',
    name: '스튜디오 · 대사',
    kind: 'AI 음성 합성',
    body: '적은 글을 요원 목소리로 새로 만들어 내요. 음성 모델이 이 기기 안에서 직접 돌아갑니다.',
  },
  {
    icon: 'changer',
    name: '체인저',
    kind: '실시간 음향 효과 (AI 아님)',
    body: '마이크나 파일의 소리에 높낮이·음색·무전기 같은 효과를 입혀요. 목소리를 새로 만들어 내는 건 아니에요.',
  },
];

export default function About() {
  const engineStatus = useAppStore((s) => s.engine.status);

  return (
    <Screen route="about" lead="콜사인이 어떤 앱인지, 내 목소리와 글이 어디로 가는지, 어떻게 쓰면 좋은지 적어 뒀어요.">
      <Split
        sideWidth="regular"
        side={
          <>
            <section className="about__card" aria-labelledby="about-keys">
              <h2 id="about-keys" className="t-head about__card-title">
                <Icon name="keyboard" size={18} />
                단축키
              </h2>
              <table className="keys">
                <caption className="sr-only">키보드 단축키</caption>
                <thead className="sr-only">
                  <tr>
                    <th scope="col">키</th>
                    <th scope="col">하는 일</th>
                  </tr>
                </thead>
                <tbody>
                  {SHORTCUTS.map((s) => (
                    <tr key={s.label}>
                      <th scope="row">
                        {s.keys.map((k, i) =>
                          k === '~' ? (
                            <span key={i} className="keys__sep">
                              ~
                            </span>
                          ) : (
                            <kbd key={i}>{k}</kbd>
                          ),
                        )}
                      </th>
                      <td>{s.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="about__card" aria-labelledby="about-env">
              <h2 id="about-env" className="t-head about__card-title">
                <Icon name="chip" size={18} />
                지금 이 기기
              </h2>
              <dl className="facts">
                <div>
                  <dt>실행 환경</dt>
                  <dd>{platform.desktop ? 'PC 앱' : WHERE[platform.kind]}</dd>
                </div>
                <div>
                  <dt>AI 음성 엔진</dt>
                  <dd>{ENGINE_STATUS[engineStatus]}</dd>
                </div>
                <div>
                  <dt>모델 크기</dt>
                  <dd>{MODEL_SIZE_LABEL}</dd>
                </div>
              </dl>
            </section>
          </>
        }
      >
        <div className="about">
          <Entry no="01" title="콜사인은">
            <p>
              목소리가 서로 다른 요원 열 명이 있는 보이스 스튜디오예요. 요원을 고르고 대사를 듣거나, 내가 쓴 글을 그 목소리로
              읽히거나, 내 목소리에 효과를 입혀 볼 수 있어요. 랩에서는 목소리를 섞어서 나만의 요원도 만들 수 있고요.
            </p>
          </Entry>

          <Entry no="02" title="두 기능은 서로 다른 기술이에요">
            <ul className="kinds">
              {TWO_KINDS.map((k) => (
                <li key={k.name}>
                  <Icon name={k.icon} size={20} className="kinds__icon" />
                  <div>
                    <p className="kinds__name">
                      {k.name} <span className="kinds__kind">{k.kind}</span>
                    </p>
                    <p className="c-pencil">{k.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Entry>

          <Entry no="03" title="요원과 대사는 전부 새로 만든 거예요">
            <p>
              요원의 이름, 성격, 대사, 문양까지 이 앱을 위해 처음부터 지었어요. 모두 오리지널이고, 특정 게임이나 작품, 실제 인물과는
              관계가 없어요.
            </p>
            <p>
              목소리도 누군가를 흉내 낸 게 아니에요. 음성 모델에 들어 있는 기본 목소리 열 가지를 섞고 음향을 다듬어서 만들었어요.
              다른 사람 목소리를 올려서 따라 하게 하는 기능은 넣지 않았습니다.
            </p>
          </Entry>

          <Entry no="04" title="전부 이 기기 안에서 처리해요">
            <ul className="bullets">
              <li>적은 글과 마이크 소리는 기기 밖으로 나가지 않아요. 서버로 보내지 않습니다.</li>
              <li>인터넷은 앱 파일과 음성 모델({MODEL_SIZE_LABEL})을 받을 때만 써요. 모델은 직접 버튼을 눌러야 받기 시작해요.</li>
              <li>사용 기록을 모으거나 추적하는 코드는 없어요.</li>
              <li>내가 만든 요원은 이 기기의 저장 공간에만 남아요.</li>
            </ul>
          </Entry>

          <Entry no="05" title="이렇게 써 주세요">
            <ul className="bullets">
              <li>실제로 있는 사람인 척하거나, 누군가를 속이는 데 쓰지 말아 주세요.</li>
              <li>만든 음성을 다른 곳에 올릴 때는 AI 로 만든 목소리라고 밝혀 주세요.</li>
              <li>남을 괴롭히거나 겁주는 말, 사기에 쓰일 수 있는 말은 만들지 말아 주세요.</li>
            </ul>
          </Entry>

          <Entry no="06" title="함께 들어간 오픈소스">
            <ul className="credits">
              {CREDITS.map((c) => (
                <li key={c.name}>
                  <span className="credits__name">{c.name}</span>
                  <span className="credits__use">{c.use}</span>
                  <span className="credits__license t-label">{c.license}</span>
                </li>
              ))}
            </ul>
            <p className="t-small c-pencil">
              음성 모델은 OpenRAIL-M 라이선스의 사용 제한(사칭·기만·괴롭힘 금지 등)을 따릅니다. 위의 사용 수칙도 그 연장이에요.
            </p>
          </Entry>
        </div>
      </Split>
    </Screen>
  );
}
