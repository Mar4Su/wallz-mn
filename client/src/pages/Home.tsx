import { useState } from "react";
import { socket } from "../socket";
import { t } from "../i18n";

type Props = {
  error: string | null;
};

export default function Home({ error }: Props) {
  const [roomCode, setRoomCode] = useState("");

  function createRoom() {
    socket.emit("create-room");
  }

  function joinRoom() {
    if (!roomCode.trim()) return;
    socket.emit("join-room", { roomId: roomCode.trim().toUpperCase() });
  }

  return (
    <main className="home">
      <section className="hero-card">
        <h1>{t.title}</h1>
        <p>{t.subtitle}</p>

        <button className="primary-button" onClick={createRoom}>
          {t.createRoom}
        </button>

        <div className="join-box">
          <input
            value={roomCode}
            onChange={(event) => setRoomCode(event.target.value)}
            placeholder={t.roomCode}
            maxLength={5}
          />
          <button onClick={joinRoom}>{t.joinRoom}</button>
        </div>

        {error && <p className="error-text">{error}</p>}
      </section>
    </main>
  );
}
