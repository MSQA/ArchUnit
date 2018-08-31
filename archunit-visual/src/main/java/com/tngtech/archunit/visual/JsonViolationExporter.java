/*
 * Copyright 2018 TNG Technology Consulting GmbH
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.tngtech.archunit.visual;

import java.io.*;
import java.util.Collection;
import java.util.List;

import com.google.common.collect.Lists;
import com.google.gson.*;
import com.google.gson.reflect.TypeToken;
import com.tngtech.archunit.core.domain.JavaCall;
import com.tngtech.archunit.core.domain.JavaFieldAccess;
import com.tngtech.archunit.lang.EvaluationResult;
import com.tngtech.archunit.lang.ViolationHandler;

class JsonViolationExporter {

    private final Gson gson = new GsonBuilder()
            .excludeFieldsWithoutExposeAnnotation()
            .create();

    //FIXME: maybe extract rule from result??
    void export(String rule, EvaluationResult result, Reader jsonViolationReader, Writer jsonViolationWriter) {
        List<JsonEvaluationResult> existingViolationsList =
                gson.fromJson(jsonViolationReader, new TypeToken<List<JsonEvaluationResult>>() {
                }.getType());
        if (existingViolationsList == null) {
            existingViolationsList = Lists.newArrayList();
        }
        export(rule, result, existingViolationsList, jsonViolationWriter);
    }

    void export(String rule, EvaluationResult result, Writer jsonViolationWriter) {
        export(rule, result, Lists.<JsonEvaluationResult>newArrayList(), jsonViolationWriter);
    }

    private void export(String rule, EvaluationResult result, List<JsonEvaluationResult> existingViolationsList, Writer jsonViolationWriter) {
        final JsonEvaluationResult evaluationResult = new JsonEvaluationResult(rule);
        extractFieldAccesses(result, evaluationResult);
        extractJavaCalls(result, evaluationResult);
        JsonEvaluationResultList existingViolations = new JsonEvaluationResultList(existingViolationsList);
        existingViolations.insertEvaluationResult(evaluationResult);
        writeToWriter(existingViolations.getJsonEvaluationResultList(), jsonViolationWriter);
    }

    private void extractJavaCalls(EvaluationResult result, final JsonEvaluationResult evaluationResult) {
        result.handleViolations(new ViolationHandler<JavaCall<?>>() {
            @Override
            public void handle(Collection<JavaCall<?>> violatingObjects, String message) {
                for (JavaCall<?> violatingObject : violatingObjects) {
                    evaluationResult.addViolation(JsonViolation.from(violatingObject));
                }
            }
        });
    }

    private void extractFieldAccesses(EvaluationResult result, final JsonEvaluationResult evaluationResult) {
        result.handleViolations(new ViolationHandler<JavaFieldAccess>() {
            @Override
            public void handle(Collection<JavaFieldAccess> violatingObjects, String message) {
                for (JavaFieldAccess violatingObject : violatingObjects) {
                    evaluationResult.addViolation(JsonViolation.from(violatingObject));
                }
            }
        });
    }

    private void writeToWriter(final List<JsonEvaluationResult> evaluationResults, Writer jsonViolationWriter) {
        gson.toJson(evaluationResults, jsonViolationWriter);
    }
}
