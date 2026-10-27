import Mathlib.Tactic
import Mathlib.Analysis.Normed.Algebra.Exponential
import Mathlib.Analysis.SpecificLimits.Basic
open scoped BigOperators
namespace Fovea

section Poisson
variable {A : Type*} [NormedRing A] [NormedAlgebra ℝ A] [CompleteSpace A]

omit [CompleteSpace A] in
theorem exp_scalar_one (x : ℝ) :
    NormedSpace.exp ℝ (x • (1 : A)) = (NormedSpace.exp ℝ x) • (1 : A) := by
  simpa only [Algebra.algebraMap_eq_smul_one] using
    (NormedSpace.map_exp ℝ (algebraMap ℝ A) (continuous_algebraMap ℝ A) x).symm

theorem poisson_identity (P : A) (t : ℝ) :
    NormedSpace.exp ℝ (t • (P - 1)) =
      (NormedSpace.exp ℝ (-t)) • ∑' n : ℕ, (t ^ n / (n.factorial : ℝ)) • P ^ n := by
  have hc : Commute ((-t) • (1 : A)) (t • P) :=
    ((Commute.one_left P).smul_left (-t)).smul_right t
  have he : t • (P - 1) = (-t) • (1 : A) + t • P := by
    simp only [smul_sub, neg_smul]
    abel
  rw [he, NormedSpace.exp_add_of_commute hc, exp_scalar_one]
  simp only [Algebra.smul_mul_assoc, one_mul, NormedSpace.exp_eq_tsum, smul_pow, smul_smul, div_eq_mul_inv]
  congr 2
  funext n
  rw [mul_comm]
end Poisson

section Tail
variable {E : Type*} [NormedAddCommGroup E] [CompleteSpace E]

theorem geometric_norm_bound (u : ℕ → E) (C r : ℝ) (_hC : 0 ≤ C)
    (hr0 : 0 ≤ r) (hr : r < 1) (hu : ∀ n, ‖u n‖ ≤ C * r ^ n) :
    Summable u ∧ ‖∑' n, u n‖ ≤ C / (1-r) := by
  have hg := (hasSum_geometric_of_lt_one hr0 hr).mul_left C
  have hn : Summable (fun n => ‖u n‖) := Summable.of_nonneg_of_le (fun n => norm_nonneg _) hu hg.summable
  refine ⟨hn.of_norm, (norm_tsum_le_tsum_norm hn).trans ?_⟩
  calc
    ∑' n, ‖u n‖ ≤ ∑' n, C * r ^ n := Summable.tsum_le_tsum hu hn hg.summable
    _ = C / (1-r) := by rw [hg.tsum_eq]; rfl
end Tail

noncomputable def poissonCoefficient (t : ℝ) (n : ℕ) : ℝ :=
  NormedSpace.exp ℝ (-t) * (t ^ n / (n.factorial : ℝ))

theorem scalar_exp_nonneg (x : ℝ) : 0 ≤ NormedSpace.exp ℝ x := by
  have h : x = x/2 + x/2 := by ring
  rw [h, NormedSpace.exp_add]
  exact mul_self_nonneg _

theorem poissonCoefficient_nonneg {t : ℝ} (ht : 0 ≤ t) (n : ℕ) :
    0 ≤ poissonCoefficient t n :=
  mul_nonneg (scalar_exp_nonneg _) (div_nonneg (pow_nonneg ht _) (Nat.cast_nonneg _))

theorem poissonCoefficient_succ (t : ℝ) (n : ℕ) :
    poissonCoefficient t (n+1) = poissonCoefficient t n * (t / (n+1)) := by
  have hn : (n.factorial : ℝ) ≠ 0 := by positivity
  have hnp : (n+1 : ℝ) ≠ 0 := by positivity
  simp only [poissonCoefficient, pow_succ, Nat.factorial_succ, Nat.cast_mul, Nat.cast_add, Nat.cast_one]
  field_simp
  ring

theorem poisson_majorant {t : ℝ} (ht : 0 ≤ t) (start m : ℕ) :
    poissonCoefficient t (start+m) ≤ poissonCoefficient t start * (t / (start+1)) ^ m := by
  induction m with
  | zero => simp
  | succ m ih =>
      rw [Nat.add_succ, poissonCoefficient_succ, pow_succ]
      have hratio : t / ((start+m : ℕ)+1) ≤ t / (start+1) := by
        apply div_le_div_of_nonneg_left ht (by positivity)
        norm_cast
        omega
      calc
        _ ≤ (poissonCoefficient t start * (t / (start+1)) ^ m) * (t / (start+1)) :=
          mul_le_mul ih hratio (div_nonneg ht (by positivity))
            (mul_nonneg (poissonCoefficient_nonneg ht _) (pow_nonneg (div_nonneg ht (by positivity)) _))
        _ = _ := by ring

theorem poisson_tail_bound {E : Type*} [NormedAddCommGroup E] [NormedSpace ℝ E] [CompleteSpace E]
    (u : ℕ → E) {t : ℝ} (ht : 0 ≤ t) (start : ℕ) (hstart : t < start+1)
    (M : ℝ) (hM : 0 ≤ M) (hu : ∀ m, ‖u m‖ ≤ M) :
    Summable (fun m => poissonCoefficient t (start+m) • u m) ∧
    ‖∑' m, poissonCoefficient t (start+m) • u m‖ ≤
      (poissonCoefficient t start * M) / (1-t/(start+1)) := by
  have hr0 : 0 ≤ t / (start+1) := div_nonneg ht (by positivity)
  have hr : t / (start+1) < 1 := (div_lt_one (by positivity)).mpr hstart
  apply geometric_norm_bound _ _ _ (mul_nonneg (poissonCoefficient_nonneg ht _) hM) hr0 hr
  intro m
  rw [norm_smul, Real.norm_eq_abs, abs_of_nonneg (poissonCoefficient_nonneg ht _)]
  calc
    poissonCoefficient t (start+m) * ‖u m‖ ≤ poissonCoefficient t (start+m) * M :=
      mul_le_mul_of_nonneg_left (hu m) (poissonCoefficient_nonneg ht _)
    _ ≤ (poissonCoefficient t start * (t/(start+1))^m) * M :=
      mul_le_mul_of_nonneg_right (poisson_majorant ht start m) hM
    _ = (poissonCoefficient t start * M) * (t/(start+1))^m := by ring

section Stochastic
variable {I J : Type*} [Fintype I] [Fintype J]

theorem weighted_bound (w x : J → ℝ) (M : ℝ) (hw : ∀ j, 0 ≤ w j)
    (hs : ∑ j, w j = 1) (hx : ∀ j, |x j| ≤ M) :
    |∑ j, w j * x j| ≤ M := by
  calc
    |∑ j, w j * x j| ≤ ∑ j, |w j * x j| := Finset.abs_sum_le_sum_abs _ _
    _ = ∑ j, w j * |x j| := by simp_rw [abs_mul, abs_of_nonneg (hw _)]
    _ ≤ ∑ j, w j * M := Finset.sum_le_sum fun j _ => mul_le_mul_of_nonneg_left (hx j) (hw j)
    _ = M := by rw [← Finset.sum_mul, hs, one_mul]

theorem column_l1_bound (P : I → J → ℝ) (x : J → ℝ)
    (hp : ∀ i j, 0 ≤ P i j) (hs : ∀ j, ∑ i, P i j = 1) :
    ∑ i, |∑ j, P i j * x j| ≤ ∑ j, |x j| := by
  calc
    ∑ i, |∑ j, P i j * x j| ≤ ∑ i, ∑ j, |P i j * x j| :=
      Finset.sum_le_sum fun i _ => Finset.abs_sum_le_sum_abs _ _
    _ = ∑ j, ∑ i, P i j * |x j| := by
      rw [Finset.sum_comm]
      simp_rw [abs_mul, abs_of_nonneg (hp _ _)]
    _ = ∑ j, |x j| := by simp_rw [← Finset.sum_mul, hs, one_mul]

noncomputable def normalizedRow [DecidableEq I] (w : I → ℝ) (self : I) (j : I) : ℝ :=
  if (∑ k, w k) = 0 then (if j = self then 1 else 0) else w j / ∑ k, w k

theorem normalizedRow_nonneg [DecidableEq I] (w : I → ℝ) (self j : I) (hw : ∀ k, 0 ≤ w k) :
    0 ≤ normalizedRow w self j := by
  unfold normalizedRow
  split_ifs <;> try positivity
  exact div_nonneg (hw j) (Finset.sum_nonneg fun k _ => hw k)

theorem normalizedRow_sum [DecidableEq I] (w : I → ℝ) (self : I) :
    ∑ j, normalizedRow w self j = 1 := by
  unfold normalizedRow
  split_ifs with h
  · simp
  · rw [← Finset.sum_div, div_self h]

noncomputable def applyRows (P : I → I → ℝ) (x : I → ℝ) (i : I) : ℝ := ∑ j, P i j * x j

theorem row_iterate_bound (P : I → I → ℝ) (hp : ∀ i j, 0 ≤ P i j)
    (hs : ∀ i, ∑ j, P i j = 1) (x : I → ℝ) (M : ℝ) (hx : ∀ i, |x i| ≤ M) (k : ℕ) :
    ∀ i, |((applyRows P)^[k] x) i| ≤ M := by
  induction k with
  | zero => simpa using hx
  | succ k ih =>
      intro i
      rw [Function.iterate_succ_apply']
      exact weighted_bound (P i) _ M (hp i) (hs i) ih

theorem column_iterate_l1_bound (P : I → I → ℝ) (hp : ∀ i j, 0 ≤ P i j)
    (hs : ∀ j, ∑ i, P i j = 1) (x : I → ℝ) (k : ℕ) :
    ∑ i, |((applyRows P)^[k] x) i| ≤ ∑ i, |x i| := by
  induction k with
  | zero => simp
  | succ k ih =>
      rw [Function.iterate_succ_apply']
      exact (column_l1_bound P _ hp hs).trans ih

end Stochastic

end Fovea
