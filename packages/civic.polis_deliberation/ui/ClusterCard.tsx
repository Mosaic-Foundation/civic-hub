import "./ClusterCard.css";

interface RepStatement {
  text: string;
  direction: "agree" | "disagree";
  repness: number;
}

interface Props {
  groupId: number;
  size: number;
  statements: RepStatement[];
}

export default function ClusterCard({ groupId, size, statements }: Props) {
  return (
    <div className="cluster-card">
      <div className="cluster-card-header">
        <span className="cluster-name">Group {groupId + 1}</span>
        <span className="cluster-size">{size} participant{size !== 1 ? "s" : ""}</span>
      </div>
      <ul className="cluster-statements">
        {statements.map((s, i) => (
          <li key={i} className="cluster-statement-item">
            <span
              className={`cluster-direction ${s.direction === "agree" ? "cluster-agree" : "cluster-disagree"}`}
            >
              {s.direction === "agree" ? "Agrees" : "Disagrees"}
            </span>
            <span className="cluster-statement-text">{s.text}</span>
            <div className="cluster-repness-bar">
              <div
                className="cluster-repness-fill"
                style={{ width: `${Math.min(s.repness * 100, 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
