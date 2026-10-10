import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

//先验证服务能否跑起来，再逐步加功能
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(3001, () => console.log("Server on http://localhost:3001"));
