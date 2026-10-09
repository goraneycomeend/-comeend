# models/

요원별 RVC 모델을 여기에 넣습니다. 저장소에는 모델 파일을 포함하지 않습니다 (`*.pth`, `*.index` 는 .gitignore).

```
models/
  jett.pth        ← agents.json 의 "model"
  jett.index      ← agents.json 의 "index" (선택, 있으면 음색 유사도가 올라감)
  omen.pth
  ...
```

파일 이름은 자유이며 `../agents.json` 의 경로만 맞추면 됩니다. 서버를 다시 시작하면 `/api/agents` 의 `ready` 가 `true` 로 바뀝니다.
