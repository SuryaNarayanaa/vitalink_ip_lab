# =============================================================================
# ENHANCED WARFARIN DOSING
# =============================================================================

rm(list = ls())
gc()

if (!requireNamespace("dplyr", quietly = TRUE)) install.packages("dplyr")
if (!requireNamespace("ggplot2", quietly = TRUE)) install.packages("ggplot2")
if (!requireNamespace("xgboost", quietly = TRUE)) install.packages("xgboost")
if (!requireNamespace("caret", quietly = TRUE)) install.packages("caret")
if (!requireNamespace("recipes", quietly = TRUE)) install.packages("recipes")
if (!requireNamespace("tidyr", quietly = TRUE)) install.packages("tidyr")
if (!requireNamespace("patchwork", quietly = TRUE)) install.packages("patchwork")
if (!requireNamespace("foreach", quietly = TRUE)) install.packages("foreach")
if (!requireNamespace("doParallel", quietly = TRUE)) install.packages("doParallel")

library(dplyr)
library(ggplot2)
library(xgboost)
library(caret)
library(recipes)
library(tidyr)
library(patchwork)
library(foreach)
library(doParallel)

# Create output directory
if (!dir.exists("output")) dir.create("output", recursive = TRUE)

# =============================================================================
# 1. DATA GENERATION
# =============================================================================

generate_warfarin_data <- function(n = 2000) {
  cat(sprintf("Generating realistic warfarin cohort (%d patients)...\n", n))
  set.seed(123)
  
  # Demographics
  age <- pmax(18, pmin(90, round(rnorm(n, 62, 14))))
  height <- round(rnorm(n, 170, 8))
  weight <- pmax(40, pmin(150, round(75 + 0.65*(height-170) + rnorm(n, 0, 10))))
  bmi <- weight / ((height/100)^2)
  gender <- sample(c("Male", "Female"), n, replace = TRUE, prob = c(0.55, 0.45))
  
  # Genetic variants
  CYP2C9 <- sample(c("*1/*1", "*1/*2", "*1/*3"), n, replace = TRUE, 
                   prob = c(0.70, 0.20, 0.10))
  VKORC1 <- sample(c("GG", "GA", "AA"), n, replace = TRUE, 
                   prob = c(0.40, 0.40, 0.20))
  CYP4F2 <- sample(c("CC", "CT", "TT"), n, replace = TRUE, 
                   prob = c(0.50, 0.40, 0.10))
  
  # Clinical variables
  amiodarone <- rbinom(n, 1, 0.15)
  aspirin <- rbinom(n, 1, 0.25)
  target_inr <- runif(n, 2.0, 3.5)
  renal_function <- pmax(15, pmin(120, round(rnorm(n, 85, 25))))
  smoker <- rbinom(n, 1, 0.25)
  
  # Calculate warfarin dose with realistic noise
  base_dose <- 0.4 * weight - 0.02 * age + 25
  
  # Genetic effects
  CYP2C9_effect <- case_when(
    CYP2C9 == "*1/*1" ~ 0,
    CYP2C9 == "*1/*2" ~ -8,
    CYP2C9 == "*1/*3" ~ -12,
    TRUE ~ 0
  )
  
  VKORC1_effect <- case_when(
    VKORC1 == "GG" ~ 0,
    VKORC1 == "GA" ~ -6,
    VKORC1 == "AA" ~ -14,
    TRUE ~ 0
  )
  
  CYP4F2_effect <- ifelse(CYP4F2 == "CC", 0,
                          ifelse(CYP4F2 == "CT", 2, 4))
  
  # Other effects
  gender_effect <- ifelse(gender == "Male", 3, -2)
  age_effect <- -0.15 * (age - 50)
  bmi_effect <- 0.2 * (bmi - 25)
  amiodarone_effect <- ifelse(amiodarone == 1, -5, 0)
  aspirin_effect <- ifelse(aspirin == 1, -2, 0)
  inr_effect <- 2 * (target_inr - 2.5)
  renal_effect <- 0.03 * (renal_function - 85)
  smoker_effect <- ifelse(smoker == 1, 1.5, 0)
  
  # Interaction terms
  age_bmi_interaction <- 0.02 * (age - 50) * (bmi - 25)
  genetic_interaction <- 0.1 * CYP2C9_effect * VKORC1_effect
  smoking_genetic_interaction <- 0.5 * smoker_effect * (CYP2C9_effect + VKORC1_effect)
  
  # Final dose with realistic noise
  warfarin_dose <- base_dose + CYP2C9_effect + VKORC1_effect + CYP4F2_effect +
    gender_effect + age_effect + bmi_effect + amiodarone_effect +
    aspirin_effect + inr_effect + renal_effect + smoker_effect +
    age_bmi_interaction + genetic_interaction + smoking_genetic_interaction +
    rnorm(n, 0, 3.5)  # Realistic noise
  
  warfarin_dose <- round(pmax(5, pmin(70, warfarin_dose)), 1)
  
  # Return data frame
  df <- data.frame(
    Age = age,
    Weight = weight,
    Height = height,
    BMI = round(bmi, 1),
    Gender = factor(gender),
    CYP2C9 = factor(CYP2C9),
    VKORC1 = factor(VKORC1),
    CYP4F2 = factor(CYP4F2),
    Amiodarone = factor(amiodarone, levels = c(0, 1), labels = c("No", "Yes")),
    Aspirin = factor(aspirin, levels = c(0, 1), labels = c("No", "Yes")),
    Smoker = factor(smoker, levels = c(0, 1), labels = c("No", "Yes")),
    Target_INR = round(target_inr, 2),
    Renal_Function = renal_function,
    WarfarinDose = warfarin_dose
  )
  
  return(df)
}

# =============================================================================
# 2. PREPROCESSING
# =============================================================================

preprocess_data <- function(data) {
  cat("Preprocessing data...\n")
  
  set.seed(123)
  split_idx <- createDataPartition(data$WarfarinDose, p = 0.8, list = FALSE)
  train_data <- data[split_idx, ]
  test_data <- data[-split_idx, ]
  
  # Simple recipe - no polynomial, just dummy encoding
  recipe_obj <- recipe(WarfarinDose ~ ., data = train_data) %>%
    step_dummy(all_nominal_predictors()) %>%
    step_normalize(all_numeric_predictors()) %>%
    prep()
  
  train_baked <- bake(recipe_obj, train_data)
  test_baked <- bake(recipe_obj, test_data)
  
  x_train <- as.matrix(train_baked[, !names(train_baked) %in% c("WarfarinDose")])
  x_test <- as.matrix(test_baked[, !names(test_baked) %in% c("WarfarinDose")])
  
  cat(sprintf("Training: %d samples, %d features\n", nrow(x_train), ncol(x_train)))
  cat(sprintf("Testing: %d samples\n", nrow(x_test)))
  
  return(list(
    x_train = x_train,
    y_train = train_baked$WarfarinDose,
    x_test = x_test,
    y_test = test_baked$WarfarinDose,
    feature_names = colnames(x_train)
  ))
}

# =============================================================================
# 3. TRAIN XGBOOST MODEL
# =============================================================================

train_xgboost_model <- function(x_train, y_train, x_test, y_test) {
  cat("Training XGBoost model...\n")
  
  dtrain <- xgb.DMatrix(x_train, label = y_train)
  dtest <- xgb.DMatrix(x_test, label = y_test)
  
  params <- list(
    objective = "reg:squarederror",
    max_depth = 7,
    eta = 0.08,
    subsample = 0.75,
    colsample_bytree = 0.75,
    gamma = 0.5,
    min_child_weight = 3,
    nthread = 4
  )
  
  model <- xgb.train(
    params = params,
    data = dtrain,
    nrounds = 200,
    watchlist = list(train = dtrain, test = dtest),
    verbose = 0,
    early_stopping_rounds = 20
  )
  
  predictions <- predict(model, dtest)
  
  return(list(model = model, predictions = predictions))
}

# =============================================================================
# 4. BOOTSTRAP VALIDATION
# =============================================================================

bootstrap_validation <- function(data, n_iterations = 10) {
  cat(sprintf("\nBootstrap validation (%d iterations - QUICK)...\n", n_iterations))
  
  # Simple bootstrap without parallel processing
  bootstrap_results <- data.frame()
  
  for(i in 1:n_iterations) {
    set.seed(123 + i)
    
    # Bootstrap sample
    boot_idx <- sample(1:nrow(data), replace = TRUE)
    boot_data <- data[boot_idx, ]
    
    # Quick train/test split (70/30)
    n_train <- floor(0.7 * nrow(boot_data))
    train_idx <- sample(1:nrow(boot_data), n_train)
    train_boot <- boot_data[train_idx, ]
    test_boot <- boot_data[-train_idx, ]
    
    # Simple preprocessing
    numeric_cols <- sapply(train_boot, is.numeric)
    x_train <- as.matrix(train_boot[, numeric_cols & names(train_boot) != "WarfarinDose"])
    x_test <- as.matrix(test_boot[, numeric_cols & names(test_boot) != "WarfarinDose"])
    y_train <- train_boot$WarfarinDose
    y_test <- test_boot$WarfarinDose
    
    # Simple model (faster)
    model <- xgboost(
      data = x_train,
      label = y_train,
      nrounds = 50,  # Fewer rounds
      max_depth = 4,  # Shallower trees
      eta = 0.1,
      verbose = 0,
      objective = "reg:squarederror"
    )
    
    pred <- predict(model, x_test)
    
    # Metrics
    r2 <- 1 - sum((y_test - pred)^2) / sum((y_test - mean(y_test))^2)
    within_20pct <- mean(abs(y_test - pred) <= 0.2 * y_test) * 100
    
    bootstrap_results <- rbind(bootstrap_results, 
                               data.frame(iteration = i, R2 = r2, Within_20pct = within_20pct))
    
    # Progress update
    if(i %% 2 == 0) cat(sprintf("  Completed %d/%d iterations\n", i, n_iterations))
  }
  
  # Calculate confidence intervals
  ci_r2 <- quantile(bootstrap_results$R2, c(0.025, 0.975), na.rm = TRUE)
  ci_within20 <- quantile(bootstrap_results$Within_20pct, c(0.025, 0.975), na.rm = TRUE)
  
  return(list(
    results = bootstrap_results,
    ci_r2 = ci_r2,
    ci_within20 = ci_within20,
    mean_r2 = mean(bootstrap_results$R2, na.rm = TRUE),
    mean_within20 = mean(bootstrap_results$Within_20pct, na.rm = TRUE)
  ))
}

# =============================================================================
# 5. EVALUATION METRICS
# =============================================================================

evaluate_model <- function(actual, predicted) {
  r2 <- 1 - sum((actual - predicted)^2) / sum((actual - mean(actual))^2)
  rmse <- sqrt(mean((actual - predicted)^2))
  mae <- mean(abs(actual - predicted))
  
  # Clinical accuracy metrics
  within_10pct <- mean(abs(actual - predicted) <= 0.1 * actual) * 100
  within_20pct <- mean(abs(actual - predicted) <= 0.2 * actual) * 100
  within_30pct <- mean(abs(actual - predicted) <= 0.3 * actual) * 100
  
  # MAE relative to mean dose
  mae_percent <- (mae / mean(actual)) * 100
  
  return(list(
    R2 = r2,
    RMSE = rmse,
    MAE = mae,
    MAE_percent = mae_percent,
    Within_10pct = within_10pct,
    Within_20pct = within_20pct,
    Within_30pct = within_30pct
  ))
}

# =============================================================================
# 6. VISUALIZATION FUNCTIONS
# =============================================================================

create_performance_plot <- function(actual, predicted, metrics) {
  plot_data <- data.frame(actual = actual, predicted = predicted)
  
  p <- ggplot(plot_data, aes(x = actual, y = predicted)) +
    geom_point(alpha = 0.6, color = "#3498DB", size = 2) +
    geom_abline(intercept = 0, slope = 1, color = "red", 
                linetype = "dashed", linewidth = 1) +
    geom_smooth(method = "lm", color = "#E74C3C", se = TRUE, alpha = 0.2) +
    annotate("text", x = min(actual) + 5, y = max(predicted) - 5,
             label = sprintf("R² = %.3f\nRMSE = %.2f mg/week\nWithin 20%% = %.1f%%",
                             metrics$R2, metrics$RMSE, metrics$Within_20pct),
             hjust = 0, vjust = 1, size = 4.5, fontface = "bold") +
    labs(title = "Warfarin Dose Prediction Performance",
         x = "Actual Dose (mg/week)", y = "Predicted Dose (mg/week)") +
    theme_minimal(base_size = 13) +
    theme(plot.title = element_text(face = "bold", size = 16, hjust = 0.5))
  
  return(p)
}

create_feature_importance_plot <- function(model, feature_names) {
  importance_matrix <- xgb.importance(model = model, feature_names = feature_names)
  
  if (is.null(importance_matrix) || nrow(importance_matrix) == 0) {
    return(NULL)
  }
  
  # Take top 10 features
  importance_matrix <- importance_matrix[1:min(10, nrow(importance_matrix)), ]
  
  p <- ggplot(importance_matrix, aes(x = reorder(Feature, Gain), y = Gain)) +
    geom_bar(stat = "identity", fill = "#27AE60", alpha = 0.8) +
    coord_flip() +
    labs(title = "Top Feature Importance",
         x = NULL, y = "Gain") +
    theme_minimal(base_size = 12) +
    theme(plot.title = element_text(face = "bold", hjust = 0.5))
  
  return(p)
}

create_bootstrap_plot <- function(bootstrap_results) {
  # Prepare data
  df_long <- bootstrap_results$results %>%
    pivot_longer(cols = c(R2, Within_20pct), 
                 names_to = "Metric", 
                 values_to = "Value")
  
  # Create summary data for annotations
  ci_data <- data.frame(
    Metric = c("R2", "Within_20pct"),
    Mean = c(bootstrap_results$mean_r2, bootstrap_results$mean_within20),
    Lower = c(bootstrap_results$ci_r2[1], bootstrap_results$ci_within20[1]),
    Upper = c(bootstrap_results$ci_r2[2], bootstrap_results$ci_within20[2])
  )
  
  # Create plot
  p <- ggplot(df_long, aes(x = Value, fill = Metric)) +
    geom_histogram(bins = 20, alpha = 0.7, position = "identity") +
    geom_vline(data = ci_data, aes(xintercept = Mean), 
               color = "#E74C3C", linetype = "solid", linewidth = 1) +
    geom_vline(data = ci_data, aes(xintercept = Lower), 
               color = "#3498DB", linetype = "dashed", linewidth = 0.8) +
    geom_vline(data = ci_data, aes(xintercept = Upper), 
               color = "#3498DB", linetype = "dashed", linewidth = 0.8) +
    facet_wrap(~Metric, scales = "free", ncol = 2,
               labeller = as_labeller(c(R2 = "R²", Within_20pct = "Within 20%"))) +
    labs(title = "Bootstrap Validation Results",
         subtitle = "50 iterations with 95% confidence intervals",
         x = "Metric Value", y = "Frequency") +
    theme_minimal(base_size = 12) +
    theme(
      plot.title = element_text(face = "bold", size = 14, hjust = 0.5),
      plot.subtitle = element_text(hjust = 0.5, color = "#555555"),
      legend.position = "none",
      strip.text = element_text(face = "bold", size = 11)
    ) +
    scale_fill_manual(values = c("#2ECC71", "#9B59B6"))
  
  return(p)
}

create_residual_plot <- function(actual, predicted) {
  residuals <- actual - predicted
  
  plot_data <- data.frame(
    Predicted = predicted,
    Residuals = residuals,
    Actual = actual
  )
  
  p <- ggplot(plot_data, aes(x = Predicted, y = Residuals)) +
    geom_point(alpha = 0.6, color = "#3498DB", size = 2) +
    geom_hline(yintercept = 0, color = "red", linetype = "dashed", linewidth = 1) +
    geom_smooth(method = "loess", color = "#E74C3C", se = TRUE, alpha = 0.2) +
    labs(title = "Residual Analysis",
         x = "Predicted Dose (mg/week)", y = "Residuals (Actual - Predicted)") +
    theme_minimal(base_size = 13) +
    theme(plot.title = element_text(face = "bold", size = 16, hjust = 0.5))
  
  return(p)
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================

cat("\n")
cat(paste(rep("=", 70), collapse = ""), "\n")
cat("ENHANCED WARFARIN DOSING - COMPLETE ANALYSIS\n")
cat(paste(rep("=", 70), collapse = ""), "\n\n")

start_time <- Sys.time()

# Step 1: Generate data
cat("Step 1: Generating dataset...\n")
data <- generate_warfarin_data(2500)
cat(sprintf("  Generated %d patients\n", nrow(data)))
cat(sprintf("  Mean dose: %.1f mg/week (SD: %.1f, Range: %.1f-%.1f)\n\n", 
            mean(data$WarfarinDose), sd(data$WarfarinDose),
            min(data$WarfarinDose), max(data$WarfarinDose)))

# Step 2: Preprocess
cat("Step 2: Preprocessing...\n")
prep <- preprocess_data(data)

# Step 3: Train model
cat("Step 3: Training XGBoost model...\n")
model_result <- train_xgboost_model(prep$x_train, prep$y_train, 
                                    prep$x_test, prep$y_test)

# Step 4: Evaluate
cat("Step 4: Evaluating performance...\n")
metrics <- evaluate_model(prep$y_test, model_result$predictions)

# Step 5: Bootstrap validation
cat("Step 5: Bootstrap validation...\n")
bootstrap_results <- bootstrap_validation(data, n_iterations = 50)

# Calculate runtime
end_time <- Sys.time()
runtime <- as.numeric(difftime(end_time, start_time, units = "mins"))

# =============================================================================
# RESULTS
# =============================================================================

cat("\n")
cat(paste(rep("=", 70), collapse = ""), "\n")
cat("FINAL RESULTS\n")
cat(paste(rep("=", 70), collapse = ""), "\n\n")

cat("PERFORMANCE METRICS:\n")
cat(sprintf("  R²: %.4f (95%% CI: %.4f-%.4f)\n", 
            metrics$R2, bootstrap_results$ci_r2[1], bootstrap_results$ci_r2[2]))
cat(sprintf("  RMSE: %.2f mg/week (95%% CI: %.2f-%.2f)\n", 
            metrics$RMSE, bootstrap_results$ci_rmse[1], bootstrap_results$ci_rmse[2]))
cat(sprintf("  MAE: %.2f mg/week (%.1f%% of mean dose)\n", 
            metrics$MAE, metrics$MAE_percent))
cat(sprintf("  Within 10%%: %.1f%%\n", metrics$Within_10pct))
cat(sprintf("  Within 20%%: %.1f%% (95%% CI: %.1f-%.1f)\n", 
            metrics$Within_20pct, 
            bootstrap_results$ci_within20[1],
            bootstrap_results$ci_within20[2]))
cat(sprintf("  Within 30%%: %.1f%%\n\n", metrics$Within_30pct))

cat("COMPUTATIONAL PERFORMANCE:\n")
cat(sprintf("  Total runtime: %.1f minutes\n", runtime))
cat(sprintf("  Bootstrap iterations: %d\n", 50))
cat(sprintf("  Features: %d\n", length(prep$feature_names)))
cat("\n")

# =============================================================================
# CREATE VISUALIZATIONS
# =============================================================================

cat("Creating publication-quality figures...\n")

# Figure 1: Performance plot
p1 <- create_performance_plot(prep$y_test, model_result$predictions, metrics)
ggsave("output/figure1_performance.png", p1, width = 10, height = 8, dpi = 300)
cat("✓ Saved: output/figure1_performance.png\n")

# Figure 2: Feature importance
p2 <- create_feature_importance_plot(model_result$model, prep$feature_names)
if (!is.null(p2)) {
  ggsave("output/figure2_feature_importance.png", p2, width = 10, height = 8, dpi = 300)
  cat("✓ Saved: output/figure2_feature_importance.png\n")
}

# Figure 3: Bootstrap results
p3 <- create_bootstrap_plot(bootstrap_results)
ggsave("output/figure3_bootstrap.png", p3, width = 12, height = 6, dpi = 300)
cat("✓ Saved: output/figure3_bootstrap.png\n")

# Figure 4: Residual plot
p4 <- create_residual_plot(prep$y_test, model_result$predictions)
ggsave("output/figure4_residuals.png", p4, width = 10, height = 8, dpi = 300)
cat("✓ Saved: output/figure4_residuals.png\n")

# Composite figure
composite <- (p1 + p2) / (p3 + p4) +
  plot_annotation(tag_levels = 'A') &
  theme(plot.tag = element_text(face = "bold", size = 14))
ggsave("output/composite_figure.png", composite, width = 16, height = 12, dpi = 300)
cat("✓ Saved: output/composite_figure.png\n\n")

# Save results
saveRDS(list(
  data = data,
  prep = prep,
  model = model_result$model,
  metrics = metrics,
  bootstrap = bootstrap_results,
  runtime = runtime
), "output/full_results.rds")

# Save model
xgb.save(model_result$model, "output/warfarin_model.xgb")

# Save summary table
summary_table <- data.frame(
  Metric = c("R²", "RMSE (mg/week)", "MAE (mg/week)", "Within 10%", 
             "Within 20%", "Within 30%", "Bootstrap R² (95% CI)",
             "Bootstrap Within 20% (95% CI)", "Runtime (minutes)",
             "Training Samples", "Test Samples", "Features"),
  Value = c(
    sprintf("%.4f", metrics$R2),
    sprintf("%.2f", metrics$RMSE),
    sprintf("%.2f (%.1f%%)", metrics$MAE, metrics$MAE_percent),
    sprintf("%.1f%%", metrics$Within_10pct),
    sprintf("%.1f%%", metrics$Within_20pct),
    sprintf("%.1f%%", metrics$Within_30pct),
    sprintf("%.4f [%.4f, %.4f]", bootstrap_results$mean_r2,
            bootstrap_results$ci_r2[1], bootstrap_results$ci_r2[2]),
    sprintf("%.1f%% [%.1f, %.1f]", bootstrap_results$mean_within20,
            bootstrap_results$ci_within20[1], bootstrap_results$ci_within20[2]),
    sprintf("%.1f", runtime),
    nrow(prep$x_train),
    nrow(prep$x_test),
    length(prep$feature_names)
  )
)

write.csv(summary_table, "output/results_summary.csv", row.names = FALSE)
cat("✓ Saved: output/results_summary.csv\n")

cat("\n")
cat(paste(rep("=", 70), collapse = ""), "\n")
cat("ANALYSIS COMPLETE!\n")
cat(paste(rep("=", 70), collapse = ""), "\n\n")

cat("Output files saved to 'output/' folder:\n")
cat("- figure1_performance.png\n")
cat("- figure2_feature_importance.png\n")
cat("- figure3_bootstrap.png\n")
cat("- figure4_residuals.png\n")
cat("- composite_figure.png\n")
cat("- results_summary.csv\n")
cat("- full_results.rds\n")
cat("- warfarin_model.xgb\n\n")

# Display first plot
print(p1)