"""국회 요구 문항의 소관 과를 추천하는 작은 분류기.

배분 규칙과 과거 접수 이력을 CSV에서 읽으며, 시험 정답은 사용하지 않는다.
"""

from __future__ import annotations

import csv
import math
import re
from collections import Counter, defaultdict
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.casefold()).strip()


def _features(text: str) -> Counter[str]:
    """문장의 주제어를 살리기 위한 글자 n-gram 특징을 만든다."""
    compact = re.sub(r"[^0-9a-z가-힣]", "", _normalize(text))
    result: Counter[str] = Counter()
    for size in (2, 3, 4, 5):
        result.update(compact[index : index + size] for index in range(len(compact) - size + 1))
    return result


class DepartmentClassifier:
    def __init__(self, data_dir: Path = DATA_DIR) -> None:
        self.departments = {
            row["과"] for row in _read_csv(data_dir / "A부_조직도_26개과.csv")
        }
        self.rules = _read_csv(data_dir / "배분기준표_소관키워드_304건.csv")
        history = _read_csv(data_dir / "요구자료_접수대장_2026국감_520건.csv")
        self.history = [
            (row["요구내용"], row["배분과"])
            for row in history
            if row["배분과"] in self.departments
        ]

        feature_rows = [_features(text) for text, _ in self.history]
        document_frequency: Counter[str] = Counter()
        for features in feature_rows:
            document_frequency.update(features.keys())
        count = len(feature_rows)
        self.idf = {
            feature: math.log((count + 1) / (frequency + 1)) + 1
            for feature, frequency in document_frequency.items()
        }
        self.history_vectors = [self._vector(features) for features in feature_rows]

    def _vector(self, features: Counter[str]) -> tuple[dict[str, float], float]:
        vector = {
            feature: (1 + math.log(frequency)) * self.idf.get(feature, 1.0)
            for feature, frequency in features.items()
        }
        norm = math.sqrt(sum(value * value for value in vector.values())) or 1.0
        return vector, norm

    def _rule_scores(self, text: str) -> dict[str, tuple[int, int]]:
        normalized = _normalize(text)
        scores: dict[str, tuple[int, int]] = {}
        for rule in self.rules:
            keyword = _normalize(rule["키워드"])
            exclusions = [_normalize(item) for item in rule["제외어"].split("|") if item]
            if keyword in normalized and not any(item in normalized for item in exclusions):
                department = rule["과"]
                if department in self.departments:
                    old_length, old_priority = scores.get(department, (0, 0))
                    # 한 과에서 여러 규칙이 맞으면 가장 구체적인 키워드의 길이와
                    # 가장 강한 우선순위를 각각 보존한다.
                    scores[department] = (
                        max(old_length, len(keyword)),
                        max(old_priority, int(rule["우선순위"])),
                    )
        return scores

    def _similarity_scores(self, text: str) -> dict[str, float]:
        query, query_norm = self._vector(_features(text))
        neighbors: list[tuple[float, str]] = []
        for (history_text, department), (vector, norm) in zip(
            self.history, self.history_vectors
        ):
            dot = sum(value * vector.get(feature, 0.0) for feature, value in query.items())
            similarity = dot / (query_norm * norm)
            neighbors.append((similarity, department))

        scores: defaultdict[str, float] = defaultdict(float)
        for similarity, department in sorted(neighbors, reverse=True)[:9]:
            scores[department] += similarity**3
        return dict(scores)

    def predict(self, requirement: str) -> str:
        """요구 문항 하나를 받아 가장 가능성 높은 조직도 내 과를 돌려준다."""
        if not requirement or not requirement.strip():
            return "확인필요"

        rule_scores = self._rule_scores(requirement)
        if rule_scores:
            # '예산', '언론' 같은 일반어보다 더 구체적인 긴 주제어를 먼저 본다.
            ranked_rules = sorted(
                rule_scores.items(), key=lambda item: (-item[1][0], -item[1][1], item[0])
            )
            best_score = ranked_rules[0][1]
            best_departments = [
                department for department, score in ranked_rules if score == best_score
            ]
            if len(best_departments) == 1:
                return best_departments[0]
            return "확인필요"

        similarity_scores = self._similarity_scores(requirement)
        candidates = set(similarity_scores)
        if not candidates:
            return "확인필요"

        combined = {department: similarity_scores[department] for department in candidates}
        ranked = sorted(combined.items(), key=lambda item: (-item[1], item[0]))
        if len(ranked) > 1 and math.isclose(ranked[0][1], ranked[1][1], abs_tol=1e-12):
            return "확인필요"
        return ranked[0][0]


_DEFAULT_CLASSIFIER: DepartmentClassifier | None = None


def find_department(requirement: str) -> str:
    """간단 사용 함수: ``find_department('요구 문항')``."""
    global _DEFAULT_CLASSIFIER
    if _DEFAULT_CLASSIFIER is None:
        _DEFAULT_CLASSIFIER = DepartmentClassifier()
    return _DEFAULT_CLASSIFIER.predict(requirement)


def evaluate_test(test_path: Path = DATA_DIR / "시험_요구문항_40건.csv") -> tuple[int, int]:
    """제공된 시험 CSV의 1순위 정답 수와 전체 문항 수를 돌려준다."""
    rows = _read_csv(test_path)
    correct = sum(
        find_department(row["요구내용"]) == row["정답_배분과"] for row in rows
    )
    return correct, len(rows)


if __name__ == "__main__":
    import sys

    if sys.argv[1:] == ["--test"]:
        right, total = evaluate_test()
        print(f"1순위 정답: {right}/{total}")
    else:
        print(find_department(" ".join(sys.argv[1:])))
