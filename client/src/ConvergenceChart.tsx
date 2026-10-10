import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { AgentStep } from "./agent";

interface Props {
  steps: AgentStep[];
}

export function ConvergenceChart({ steps }: Props) {
  const data = steps
    .filter((s) => s.tool === "run_eslint")
    .map((s, i) => ({
      name: `第${i + 1}次`,
      errors: s.errors.length,
    }));

  return (
    <div style={{ marginTop: 20 }}>
      <h3>报错数收敛曲线</h3>
      <div
        style={{
          background: "#fff",
          padding: 12,
          borderRadius: 6,
          border: "1px solid #ddd",
          minHeight: 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {data.length < 2 ? (
          <p style={{ color: "#999", fontSize: 13, margin: 0 }}>
            审查开始后，这里会显示报错数随步骤的收敛曲线
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={12} />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="errors"
                stroke="#ff6b6b"
                strokeWidth={2}
                dot={{ r: 4 }}
                name="报错数"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <p style={{ fontSize: 12, color: "#999", margin: "8px 0 0" }}>
        曲线下降表示 Agent 在收敛（报错数减少）
      </p>
    </div>
  );
}
