# CLAUDE.md

Orientações para o Claude Code (e humanos) trabalharem neste repositório.

## Visão geral

**Sorteio (Turfe)** é uma aplicação web de página única que realiza sorteios/premiações
no formato de uma **corrida de cavalos animada**. Cada participante vira um cavalo; o
vencedor é quem cruza a linha de chegada primeiro. A proposta é substituir o sorteio
"monótono" por um evento ao vivo, com narração, som e animação.

Há três modos:
- **🏇 Corrida única** (`single`) — uma corrida decide o ganhador.
- **🏆 Torneio** (`tournament`) — eliminatórias (baterias) cujos vencedores avançam até a grande final.
- **👥 Por equipes** (`teams`) — cada participante tem uma equipe; além do vencedor individual, calcula a equipe campeã por pontos.

## Arquitetura

- **Arquivo único**: `index.html` contém **tudo** — marcação HTML, CSS (`<style>`) e
  JavaScript (`<script>`). Não há build, bundler, `package.json` nem backend. O **app** é um
  único arquivo; o repo inclui só uma suíte de testes dev (Node, sem deps) em `tests/`.
- **Modular por dentro**: o JS vive sob um único namespace global **`App`**. Cada
  recurso é um **módulo** (IIFE que devolve sua API pública) com responsabilidade
  única. Para adicionar/remover/alterar algo, mexa só no módulo correspondente.
- **Única dependência externa**: `jsPDF` via CDN (`cdnjs`), usada apenas para exportar
  PDF/certificado. Todo o resto é **vanilla JS**.
- **Estado em memória + cadastro persistido**: o estado vive em **`App.State`** (cadastro,
  corrida, torneio, runtime). Só o **cadastro** (participantes, equipes, prêmio, semente,
  modo) é salvo no `localStorage` por **`App.Store`** e restaurado ao recarregar (a corrida/
  torneio/runtime continuam voláteis). Um link compartilhado tem prioridade sobre o rascunho.
  As **preferências de UI** (tema, mudo/voz, volume) também ficam no `localStorage`, numa
  chave própria via `App.Store.pref()`.
- **Idioma**: produto e código (comentários, strings, nomes de função) estão em **português (pt-BR)**.

### Módulos (ordem de dependência no `<script>`)

| Módulo | Responsabilidade |
|---|---|
| `App.Config` (`CFG`) | Constantes e parâmetros ajustáveis — **1 lugar para tunar tudo** |
| `App.Log` | Logger com níveis (debug/info/warn/error) + timestamp + módulo |
| `App.Util` (`U`) | Helpers puros: `esc`, `argmax`, `clamp`, `corOf`, `rndPick` |
| `App.Dom` (`D`) | Atalhos de DOM: `id`, `qsa`, `on`, `setText`, `setHTML` |
| `App.RNG` | `mulberry32` + `shuffle` (base do sorteio justo) |
| `App.State` (`S`) | Estado central mutável (lido/escrito pelos demais) |
| `App.Store` | Persistência local (localStorage): **cadastro** (auto), **preferências** de UI via `pref()` (tema, mudo/voz, volume) e **histórico** via `histLoad/histSave` |
| `App.History` | Histórico de sorteios: registra cada resultado (vencedor + semente + cadastro) e permite **reabrir** (reproduz exatamente) |
| `App.View` | Chrome visual + a11y: **tema** claro/escuro (persistido), **tela cheia**, `reducedMotion()` (respeita `prefers-reduced-motion`) e `announce()` (região `aria-live`) |
| `App.Timing` | `seq`/`clearSeq` (timers agendados com try/catch) |
| `App.Bus` | Event bus mínimo (`on`/`emit`) — desacopla reações |
| `App.Audio` | Web Audio (sons sintetizados) + narração por voz + **volume/mudo** (nó `master`, persistidos) |
| `App.Sim` | **Simulação determinística** (`simulate(seed, n)`) |
| `App.Screens` | Troca de tela (`show(id)`) |
| `App.Teams` | Equipes (criar/remover/cores/placar) |
| `App.Roster` | Participantes (adicionar/colar/remover/validar) |
| `App.Modes` | Alterna o modo (single/tournament/teams) |
| `App.Render` | Desenho da pista/cavalos/badges/ranks |
| `App.Narration` | Falas + reação aos eventos da corrida (assina o `Bus`) |
| `App.PhotoFinish` | Foto da chegada (canvas) em chegadas apertadas |
| `App.FX` | Confete/fogos da comemoração |
| `App.Race` | Orquestra UMA corrida (largada → playback → fim → foto) |
| `App.Tournament` | Baterias/chaveamento até a grande final |
| `App.Result` | Revelação, pódio, stats, placar de equipes, exportar |
| `App.Export` | PDF do resultado, certificado e imagem PNG |
| `App.QR` | Gerador de QR Code próprio (vanilla, byte mode/nível L); desenha no canvas e exporta **PNG/SVG** |
| `App.UI` | Fiação: delegação de cliques (`data-action`), teclado, `init` |

Aliases curtos para os módulos fundamentais: `CFG`, `Log`, `U`, `D`, `S`.
Cross-referência entre módulos de feature usa `App.X.fn(...)` (resolvido em runtime,
o que evita problemas de ordem/ciclos, ex.: `Race` ↔ `Tournament`).

### Logging

Logger verboso por padrão. Cada mensagem tem timestamp, módulo e dados estruturados.
Ajuste o nível em `Config.log.level` ou pela URL: `?log=info` (ou `warn`/`error`/`silent`).
Em runtime: `App.Log.setLevel('info')`. Erros globais (`window.onerror` e
`unhandledrejection`) também são logados com origem.

## Como executar

Abrir `index.html` diretamente no navegador já funciona. Para evitar restrições de
`file://` e garantir áudio/narração, prefira servir localmente:

```bash
python3 -m http.server 8000   # depois acesse http://localhost:8000
```

Áudio (Web Audio API) e narração (Web Speech API) só iniciam após interação do usuário,
por causa das políticas de autoplay dos navegadores. Não há lint/build; os testes ficam em
`tests/run.mjs` (`node tests/run.mjs`, sem dependências).

## Estrutura do `index.html`

- **CSS** (`<style>`): variáveis de tema em `:root` e blocos comentados (formulários,
  botões, modos, listas, pista/cavalos, largada/photo finish, bateria, resultado).
- **HTML**: 4 telas (`.screen`), trocadas por `App.Screens.show(id)`:
  - `#screen-cadastro` — entrada de participantes, equipes, prêmio e semente.
  - `#screen-corrida` — a animação da corrida.
  - `#screen-heat` — resultado de cada bateria do torneio (chaveamento).
  - `#res` — revelação do vencedor, pódio, estatísticas e exportação.
  Botões **não usam `onclick` inline**: usam `data-action` (+ `data-arg`/`data-idx`).
- **JavaScript**: namespace `App` com os módulos da tabela acima, na ordem de
  dependência. O bloco de comentário no topo do `<script>` resume a arquitetura.

## Conceitos-chave

- **Simulação determinística**: `App.Sim.simulate(seed, n)` usa o RNG `mulberry32` e
  **pré-calcula todos os frames, eventos e a ordem de chegada antes** de a animação rodar.
  O playback (`App.Race`) apenas reproduz os frames já calculados. A mesma semente (e o
  mesmo `n`) reproduz exatamente o mesmo sorteio — é o "sorteio justo".
- **Separação simulação ↔ render**: o resultado vem de `App.Sim`; o desenho fica em
  `App.Render` (`pista`/`frameAt`/`updateRanks`). Mudou o resultado? vá na simulação.
  Mudou o visual? vá na renderização.
- **Sprite por sorteio (não pela ordem)**: o "bicho" de cada participante (`CFG.HORSES`) é
  **embaralhado pela semente** em `App.Race.run` (`App.RNG.shuffle(..., mulberry32(seed))`,
  RNG separado da simulação) e só aparece na **largada** — assim ninguém "escolhe" o sprite
  pela ordem do cadastro. É reproduzível pelo link (mesma semente = mesmos sprites). No
  cadastro, os chips mostram um 🙂 neutro (placeholder, sem revelar nada).
- **Eventos via Bus**: `App.Sim` gera eventos `trip`/`mud`/`burst`/`lead`/`split`. Durante
  o playback, `App.Race` faz `App.Bus.emit('race:event', …)` e `App.Narration` reage
  (narra + som). Para somar uma reação nova, basta `App.Bus.on('race:event', …)`.
- **Torneio**: `App.Tournament.makeHeats` distribui em baterias (máx. `MAXHEAT`); o fluxo é
  `start → beginRound → runHeatRace → showHeatResult → continuar` até a final.
- **`data-action`**: a tabela `ACTIONS` em `App.UI` mapeia a ação ao módulo. Botão novo =
  `data-action="x"` no HTML + entrada em `ACTIONS`. Um único listener cuida de tudo
  (som do clique, fechar menus ao clicar fora, despachar a ação).
- **Link/URL compartilhável**: `App.Result.copyLink`/`buildShareUrl` geram um link que reproduz
  o sorteio (modo + participantes + prêmio + semente). Os dados vão no **fragmento `#`** (que NÃO trafega
  no GET — sem limite de servidor) e **comprimidos** (`#d=<base64url(deflate-raw)>`, via
  `CompressionStream`; helpers em `App.Util`) — encurta muito p/ listas grandes (ex.: 100 nomes
  ~3 KB → centenas de bytes). No boot, `App.UI.applyUrlParams` (async) descomprime e
  **pré-preenche** o cadastro (sem auto-iniciar), com fallback p/ fragmento cru `#…` e p/
  `?query` antiga. Parsing reusa `URLSearchParams` (`modo`, `getAll('n')/('t')`, `p` (prêmio), `seed`).
- **Acessibilidade**: foco visível (`:focus-visible`), `aria-label` nos campos, modal do QR como
  `role="dialog"` (foco entra ao abrir, `Esc` fecha e devolve o foco) e anúncios de resultado por
  `App.View.announce()` (região `#srLive` `aria-live`). Com **`prefers-reduced-motion`**,
  `App.View.reducedMotion()` faz a corrida **pular a animação e ir direto ao resultado**
  (`App.Race.runFast()` + revelação sem suspense/confete); o CSS também zera transições/animações.
  Para **daltonismo**, a paleta é segura (Okabe-Ito) e — como cores quentes convergem no
  vermelho-verde — o **número da baia** (`.raia-n`, reforçado) e o **nome** são os identificadores
  que não dependem de cor.

## Parâmetros (tudo em `App.Config`)

- `MAX = 100` — limite de participantes; `MAXHEAT = 6` — máx. por bateria.
- `HORSES`, `PAL`, `TEAMPAL` (paletas **seguras p/ daltonismo** — Okabe-Ito; ordem intercala frio/quente), `APPNAME`, `MODE_HINTS`.
- `Config.sim` — parâmetros da simulação (FIM, STEP, probabilidades, multiplicadores…).
  **Mexer aqui muda o resultado da corrida; revalide o determinismo.**
- `Config.timing`, `Config.crowd`, `Config.photo` — tempos, volumes da torcida e a foto.
  - `Config.timing.narrMinGap` — tempo mínimo (ms) que cada fala fica na tela (ritmo legível).
- `Config.voice` — narração por voz (`rate`/`pitch` ~1.0 = natural, fácil de entender).
- `Config.log.level` — verbosidade do logger.

## Convenções ao editar

- **Mantenha tudo em um arquivo**: não introduza build, dependências locais ou frameworks
  sem necessidade real; o valor do projeto está em ser autocontido.
- **Um módulo por responsabilidade**: novo recurso → novo módulo `App.X` (ou edite o dono
  do assunto). Cross-referência via `App.X.fn(...)`. Use `Log` à vontade.
- **Escape de entrada do usuário**: use sempre `U.esc()` ao montar markup com dados do usuário.
- **Determinismo**: nunca use `Math.random()` dentro de `App.Sim`; só o `rng` semeado, e
  **não reordene/insira chamadas a `rng()`** (a ordem é o contrato de reprodutibilidade).
- **Português**: novas strings de UI e narração em pt-BR, no tom animado já existente.
- **Áudio**: sons são sintetizados (sem arquivos). Reaproveite os helpers de `App.Audio`
  (`beep`, `note`, `noise`) em vez de adicionar assets.

## Testar/validar

Há uma **suíte sem dependências** em `tests/run.mjs` (só `node`, sem navegador), rodada
pelo **CI** (`.github/workflows/ci.yml`) a cada push/PR:

```bash
node tests/run.mjs            # roda tudo
node tests/run.mjs --update   # regenera o golden (após mudança INTENCIONAL na simulação)
```

Ela carrega o **`index.html` real** num contexto `vm` (com stubs mínimos de DOM) e cobre:
- **Determinismo (sorteio justo)**: `simulate(seed,n)` reprodutível e sensível à semente; RNG
  determinístico; e a ordem de chegada (+ eventos) **travada por um golden hash** sobre uma
  grade de sementes × `n` (`tests/golden-sim.json`). Mudou a simulação de propósito? rode `--update`.
- **QR Code**: format info nas posições da ISO (regressão do bug de transposição), estrutura
  (finder patterns), e **round-trip** com um decodificador independente (reescrito pela ISO).

Complementarmente, dá pra fazer um **teste funcional headless** (Playwright): abrir o `file://`,
exercitar UI/corrida/torneio/foto e conferir zero `console`/`pageerror`.
