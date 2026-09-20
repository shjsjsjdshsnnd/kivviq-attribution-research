from __future__ import annotations

import ast
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import phase2_candidate_sdk
from phase2_candidate_sdk import (
    CandidateResponse,
    DeclaredContext,
    ObservableDataset,
    validate_candidate_response,
)


class ForbiddenCandidateImport(ValueError):
    pass


class CandidateExecutionError(RuntimeError):
    pass


class CandidateSourceValidator(ast.NodeVisitor):
    """Block normal candidate access to harness/evaluator modules."""

    def _check_module(self, module: str) -> None:
        if module == "attribution_lab" or module.startswith("attribution_lab."):
            raise ForbiddenCandidateImport(
                "candidate modules may not import attribution_lab during evaluation"
            )

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self._check_module(alias.name)
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.module:
            self._check_module(node.module)
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        dynamic_name = None
        if isinstance(node.func, ast.Name) and node.func.id == "__import__":
            dynamic_name = "__import__"
        elif (
            isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "importlib"
            and node.func.attr == "import_module"
        ):
            dynamic_name = "importlib.import_module"
        if dynamic_name and node.args and isinstance(node.args[0], ast.Constant):
            value = node.args[0].value
            if isinstance(value, str):
                self._check_module(value)
        self.generic_visit(node)


def validate_candidate_source(source: str) -> None:
    tree = ast.parse(source)
    CandidateSourceValidator().visit(tree)


_RUNNER = r"""
import importlib
import json
import sys
from pathlib import Path

class _GuardFinder:
    def find_spec(self, fullname, path=None, target=None):
        if fullname == "attribution_lab" or fullname.startswith("attribution_lab."):
            raise ImportError("evaluator modules are unavailable to candidate code")
        return None

workspace = Path(__file__).resolve().parent
sys.path.insert(0, str(workspace))
sys.meta_path.insert(0, _GuardFinder())

from phase2_candidate_sdk import CandidateResponse, DeclaredContext, ObservableDataset

request_path = Path(sys.argv[1])
response_path = Path(sys.argv[2])
payload = json.loads(request_path.read_text(encoding="utf-8"))
module = importlib.import_module("candidate_module")
if not hasattr(module, "estimate"):
    raise RuntimeError("candidate module must define estimate(dataset, context)")
dataset = ObservableDataset.from_dict(payload["dataset"])
context = DeclaredContext.from_dict(payload["context"])
result = module.estimate(dataset, context)
if not isinstance(result, CandidateResponse):
    raise TypeError("candidate estimate() must return CandidateResponse")
response_path.write_text(json.dumps(result.as_dict(), sort_keys=True), encoding="utf-8")
"""


class CandidateRunner:
    def __init__(self) -> None:
        self.last_workspace: Path | None = None

    def execute(
        self,
        source: str,
        dataset: ObservableDataset,
        context: DeclaredContext,
    ) -> CandidateResponse:
        validate_candidate_source(source)
        sdk_root = Path(phase2_candidate_sdk.__file__).resolve().parent

        with tempfile.TemporaryDirectory(prefix="phase2-candidate-") as raw_workspace:
            workspace = Path(raw_workspace)
            self.last_workspace = workspace
            shutil.copytree(sdk_root, workspace / "phase2_candidate_sdk")
            (workspace / "candidate_module.py").write_text(source, encoding="utf-8")
            (workspace / "runner.py").write_text(_RUNNER, encoding="utf-8")
            request = {
                "dataset": dataset.as_dict(),
                "context": context.as_dict(),
            }
            request_path = workspace / "request.json"
            response_path = workspace / "response.json"
            request_path.write_text(
                json.dumps(request, sort_keys=True),
                encoding="utf-8",
            )
            completed = subprocess.run(
                [
                    sys.executable,
                    "-I",
                    str(workspace / "runner.py"),
                    str(request_path),
                    str(response_path),
                ],
                cwd=workspace,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            if completed.returncode != 0 or not response_path.exists():
                raise CandidateExecutionError("candidate execution failed")
            response = CandidateResponse.from_dict(
                json.loads(response_path.read_text(encoding="utf-8"))
            )
            validate_candidate_response(response)
            return response
