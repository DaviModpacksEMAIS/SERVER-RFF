# Futebol 3D — servidor online (passo 2)

- `sim/core.js`: a simulação do jogo (física, IA, regras) rodando em Node, sem navegador.
- `server.js`: servidor HTTP + WebSocket na mesma porta, com salas por código (até 2v2, bots completam o resto).
- `public/index.html`: página de teste em vista de cima, pra validar o servidor e medir o ping. O 3D completo vem depois.

    npm install
    npm start          # http://localhost:3000
    npm test           # simulação, humanos simulados e rede ponta a ponta

## Subir no Render (grátis)
1. Crie um repositório no GitHub e suba esta pasta (sem `node_modules`).
2. Em render.com: New + → Blueprint → escolha o repositório. Ele lê o `render.yaml`.
3. Quando terminar, abra o link `https://….onrender.com`, digite nome e um código de sala, e mande o mesmo link e código pros amigos.

O plano grátis dorme após ~15 min sem uso; o primeiro a entrar espera uns 30–60 s.

## Limites que já existem
- 10 salas por servidor, 2 jogadores por time, mensagens de até 2 KB, 200 entradas/s por jogador.
- Sala vazia é apagada depois de 30 s, e a partida reinicia sozinha 10 s depois do apito final.
