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
  JavaScript (`<script>`). Não há build, bundler, `package.json`, testes nem backend.
- **Única dependência externa**: `jsPDF` via CDN (`cdnjs`), usada apenas para exportar
  PDF/certificado. Todo o resto é **vanilla JS**.
- **Sem persistência**: o estado vive em variáveis globais em memória (`participantes`,
  `teams`, `tour`, `sim`, etc.). Recarregar a página zera tudo.
- **Idioma**: produto e código (comentários, strings, nomes de função) estão em **português (pt-BR)**.

## Como executar

Abrir `index.html` diretamente no navegador já funciona. Para evitar restrições de
`file://` e garantir áudio/narração, prefira servir localmente:

```bash
python3 -m http.server 8000   # depois acesse http://localhost:8000
```

Áudio (Web Audio API) e narração (Web Speech API) só iniciam após interação do usuário,
por causa das políticas de autoplay dos navegadores. Não há lint/test/build.

## Estrutura do `index.html`

- **CSS** (`<style>`): variáveis de tema em `:root`, layout das telas (`.screen`), e
  estilos da pista/cavalos/pódio/confete.
- **HTML**: 4 telas (`.screen`), alternadas pela função `tela(id)`:
  - `#screen-cadastro` — entrada de participantes, equipes, prêmio e semente.
  - `#screen-corrida` — a animação da corrida.
  - `#screen-heat` — resultado de cada bateria do torneio (chaveamento).
  - `#res` — revelação do vencedor, pódio, estatísticas e exportação.
- **JavaScript**: organizado em seções marcadas por comentários `/* ===== X ===== */`:
  `ÁUDIO`, `MODOS`, `EQUIPES`, `CADASTRO`, `NARRAÇÃO`, `SIMULAÇÃO (determinística)`,
  `CONTROLE`, `TORNEIO`, `RESULTADO`, `PDF / IMAGEM`, `LARGADA VISUAL`, `FESTA`.

## Conceitos-chave

- **Simulação determinística**: `simulate(seed)` usa o RNG `mulberry32` e **pré-calcula
  todos os frames, eventos e a ordem de chegada antes** de a animação rodar. A animação
  (`startPlayback`) apenas reproduz os frames já calculados. A mesma semente reproduz
  exatamente o mesmo sorteio — é o que sustenta o "sorteio justo" e a reprodução via
  "Opções avançadas".
- **Separação simulação ↔ render**: lógica do resultado fica em `simulate`; o desenho fica
  em `renderPista`/`startPlayback`/`updateRanks`. Mudanças no resultado vão na simulação;
  mudanças visuais, na renderização.
- **Eventos da corrida**: `trip` (tropeço), `mud` (lama), `burst` (arrancada),
  `lead` (virada de liderança) e `split` (parciais 25/50/75%) são gerados na simulação e
  narrados em `handleEvent`.
- **Torneio**: `makeHeats` distribui em baterias (máx. `MAXHEAT`); o fluxo é
  `startTournament → beginRound → runHeatRace → showHeatResult → continuarTorneio` até a final.

## Constantes importantes (topo do `<script>`)

- `MAX = 100` — limite de participantes.
- `MAXHEAT = 6` — máximo de participantes por bateria no torneio.
- `HORSES`, `PAL`, `TEAMPAL` — emojis e paletas de cores.
- `APPNAME = 'Sorteio (Turfe)'` — usado nas exportações (PDF/imagem).

## Convenções ao editar

- **Mantenha tudo em um arquivo**: não introduza build, dependências locais ou frameworks
  sem necessidade real; o valor do projeto está em ser autocontido.
- **Escape de entrada do usuário**: nomes/equipes são interpolados em HTML — use sempre a
  função `esc()` ao montar markup com dados do usuário.
- **Determinismo**: qualquer alteração na corrida deve preservar a reprodutibilidade por
  semente. Não use `Math.random()` dentro de `simulate`; use o `rng` semeado.
- **Português**: novas strings de UI e narração em pt-BR, no tom animado já existente.
- **Áudio**: sons são sintetizados (sem arquivos). Reaproveite os helpers (`beep`, `note`,
  `noise`) em vez de adicionar assets.
